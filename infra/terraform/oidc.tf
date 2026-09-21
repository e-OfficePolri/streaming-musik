# OIDC federation: GitHub Actions tukar token identitasnya (membuktikan "saya
# workflow dari repo X") ke kredensial AWS sementara, tanpa access key jangka
# panjang yang disimpan sebagai GitHub secret dan bisa bocor.

variable "github_repo" {
  description = "Repo GitHub dalam format owner/nama-repo, untuk membatasi siapa yang boleh assume role ini"
  type        = string
  # contoh: "namamu/streaming-musik" — WAJIB diisi lewat terraform.tfvars
}

resource "aws_iam_openid_connect_provider" "github" {
  url             = "https://token.actions.githubusercontent.com"
  client_id_list  = ["sts.amazonaws.com"]
  thumbprint_list = ["6938fd4d98bab03faadb97b34396831e3780aea1"]
}

resource "aws_iam_role" "github_actions" {
  name = "${var.project_name}-${var.environment}-github-actions"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Federated = aws_iam_openid_connect_provider.github.arn }
      Action    = "sts:AssumeRoleWithWebIdentity"
      Condition = {
        StringEquals = {
          "token.actions.githubusercontent.com:aud" = "sts.amazonaws.com"
        }
        # Dibatasi ke branch main saja — cegah workflow dari branch/PR lain
        # deploy ke produksi tanpa review.
        StringLike = {
          "token.actions.githubusercontent.com:sub" = "repo:${var.github_repo}:ref:refs/heads/main"
        }
      }
    }]
  })
}

# Izin minimal yang dibutuhkan workflow: push image ke ECR dan update ECS
# service. TIDAK diberi akses penuh (AdministratorAccess) — kalau token
# GitHub bocor, blast radius-nya terbatas ke dua hal ini saja.
resource "aws_iam_role_policy" "github_actions_deploy" {
  name = "${var.project_name}-${var.environment}-github-actions-deploy"
  role = aws_iam_role.github_actions.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Action = [
          "ecr:GetAuthorizationToken",
        ]
        Resource = "*" # action ini memang tidak mendukung resource spesifik
      },
      {
        Effect = "Allow"
        Action = [
          "ecr:BatchCheckLayerAvailability",
          "ecr:GetDownloadUrlForLayer",
          "ecr:PutImage",
          "ecr:InitiateLayerUpload",
          "ecr:UploadLayerPart",
          "ecr:CompleteLayerUpload",
        ]
        Resource = [for repo in aws_ecr_repository.services : repo.arn]
      },
      {
        Effect = "Allow"
        Action = [
          "ecs:DescribeTaskDefinition",
          "ecs:RegisterTaskDefinition",
        ]
        Resource = "*" # dua action ini juga tidak mendukung resource spesifik
      },
      {
        Effect = "Allow"
        Action = [
          "ecs:UpdateService",
          "ecs:DescribeServices",
        ]
        Resource = [
          aws_ecs_service.auth_service.id,
          aws_ecs_service.catalog_service.id,
          aws_ecs_service.media_service.id,
          aws_ecs_service.payment_service.id,
        ]
      },
      {
        # Dibutuhkan ECS untuk pasang role ke task definition revisi baru
        # yang diregister lewat CI — tanpa ini, RegisterTaskDefinition gagal.
        Effect = "Allow"
        Action = "iam:PassRole"
        Resource = [
          aws_iam_role.ecs_execution.arn,
          aws_iam_role.auth_service_task.arn,
          aws_iam_role.media_service_task.arn,
          aws_iam_role.payment_service_task.arn,
        ]
      },
    ]
  })
}

output "github_actions_role_arn" {
  description = "ARN role ini — isi sebagai secret AWS_ROLE_ARN di GitHub repo settings"
  value       = aws_iam_role.github_actions.arn
}
