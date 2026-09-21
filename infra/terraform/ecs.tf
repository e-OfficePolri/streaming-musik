# ECS Fargate dipilih dibanding EC2-based ECS atau self-managed Kubernetes
# supaya tidak perlu mengelola server/node sama sekali di tahap awal —
# AWS yang menangani provisioning compute per task. Migrasi ke EKS bisa
# dilakukan nanti kalau kebutuhan orkestrasi jadi lebih kompleks.

resource "aws_ecs_cluster" "main" {
  name = "${var.project_name}-${var.environment}"

  setting {
    name  = "containerInsights"
    value = "enabled"
  }
}

resource "aws_security_group" "ecs_tasks" {
  name_prefix = "${var.project_name}-${var.environment}-ecs-"
  vpc_id      = aws_vpc.main.id

  ingress {
    from_port       = 0
    to_port         = 65535
    protocol        = "tcp"
    security_groups = [aws_security_group.alb.id]
  }

  # Izinkan service saling panggil langsung (service-to-service), TANPA
  # lewat ALB — dibutuhkan media-service untuk memanggil payment-service
  # saat cek status subscription (lihat internal/subscription/checker.go).
  # "self = true" berarti anggota grup ini boleh terima traffic dari
  # anggota grup ini juga.
  ingress {
    from_port = 0
    to_port   = 65535
    protocol  = "tcp"
    self      = true
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = {
    Name = "${var.project_name}-${var.environment}-ecs-sg"
  }
}

resource "aws_security_group" "alb" {
  name_prefix = "${var.project_name}-${var.environment}-alb-"
  vpc_id      = aws_vpc.main.id

  ingress {
    from_port   = 443
    to_port     = 443
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }

  ingress {
    from_port   = 80
    to_port     = 80
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = {
    Name = "${var.project_name}-${var.environment}-alb-sg"
  }
}

# Application Load Balancer berperan sebagai API gateway di produksi —
# menggantikan nginx.conf yang dipakai untuk local dev (lihat gateway/).
resource "aws_lb" "main" {
  name               = "${var.project_name}-${var.environment}-alb"
  internal           = false
  load_balancer_type = "application"
  security_groups    = [aws_security_group.alb.id]
  subnets            = aws_subnet.public[*].id
}

resource "aws_ecr_repository" "services" {
  for_each             = toset(["auth-service", "catalog-service", "media-service", "payment-service"])
  name                 = "${var.project_name}/${each.key}"
  image_tag_mutability = "MUTABLE"
}

resource "aws_ecs_task_definition" "auth_service" {
  family                   = "${var.project_name}-${var.environment}-auth-service"
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = 256
  memory                   = 512
  execution_role_arn       = aws_iam_role.ecs_execution.arn
  task_role_arn            = aws_iam_role.auth_service_task.arn

  container_definitions = jsonencode([{
    name  = "auth-service"
    image = "${aws_ecr_repository.services["auth-service"].repository_url}:latest"
    portMappings = [{ containerPort = 3001, protocol = "tcp" }]
    environment = [
      { name = "DB_HOST", value = aws_db_instance.main.address },
      { name = "DB_NAME", value = var.db_name },
      { name = "DB_USER", value = var.db_username },
      # Dipakai LoginRateLimitService untuk membatasi percobaan login gagal.
      { name = "REDIS_HOST", value = aws_elasticache_cluster.main.cache_nodes[0].address },
      { name = "REDIS_PORT", value = tostring(aws_elasticache_cluster.main.cache_nodes[0].port) },
      # Dipakai EmailService untuk kirim email reset password lewat SES.
      # Domain di SES_FROM_EMAIL harus sudah diverifikasi manual di SES
      # console dulu (SES butuh verifikasi domain/email pengirim).
      { name = "AWS_SES_REGION", value = var.aws_region },
      { name = "SES_FROM_EMAIL", value = var.ses_from_email },
      { name = "APP_WEB_URL", value = var.app_web_url },
      # DB_PASSWORD dan JWT_SECRET sengaja TIDAK di sini — ambil dari
      # AWS Secrets Manager lewat blok "secrets" saat setup produksi nyata.
    ]
    logConfiguration = {
      logDriver = "awslogs"
      options = {
        "awslogs-group"         = "/ecs/${var.project_name}-${var.environment}/auth-service"
        "awslogs-region"        = var.aws_region
        "awslogs-stream-prefix" = "ecs"
      }
    }
  }])
}

resource "aws_ecs_task_definition" "catalog_service" {
  family                   = "${var.project_name}-${var.environment}-catalog-service"
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = 256
  memory                   = 512
  execution_role_arn       = aws_iam_role.ecs_execution.arn

  container_definitions = jsonencode([{
    name  = "catalog-service"
    image = "${aws_ecr_repository.services["catalog-service"].repository_url}:latest"
    portMappings = [{ containerPort = 3002, protocol = "tcp" }]
    environment = [
      { name = "DB_HOST", value = aws_db_instance.main.address },
      { name = "DB_NAME", value = var.db_name },
      { name = "DB_USER", value = var.db_username },
      # DB_PASSWORD sengaja TIDAK di sini — ambil dari AWS Secrets Manager
      # lewat blok "secrets" saat setup produksi nyata.
    ]
    logConfiguration = {
      logDriver = "awslogs"
      options = {
        "awslogs-group"         = "/ecs/${var.project_name}-${var.environment}/catalog-service"
        "awslogs-region"        = var.aws_region
        "awslogs-stream-prefix" = "ecs"
      }
    }
  }])
}

resource "aws_ecs_task_definition" "media_service" {
  family                   = "${var.project_name}-${var.environment}-media-service"
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  # CPU/memory lebih besar dari service lain — media-service menangani
  # transcoding, beban kerjanya lebih berat dibanding CRUD biasa.
  cpu                = 1024
  memory             = 2048
  execution_role_arn = aws_iam_role.ecs_execution.arn
  task_role_arn      = aws_iam_role.media_service_task.arn

  container_definitions = jsonencode([{
    name  = "media-service"
    image = "${aws_ecr_repository.services["media-service"].repository_url}:latest"
    portMappings = [{ containerPort = 8080, protocol = "tcp" }]
    environment = [
      { name = "CDN_DOMAIN", value = aws_cloudfront_distribution.audio.domain_name },
      { name = "S3_AUDIO_BUCKET", value = aws_s3_bucket.audio.id },
      { name = "CLOUDFRONT_KEY_PAIR_ID", value = aws_cloudfront_public_key.signing.id },
      # Dipakai subscription.Checker untuk cache status langganan dan
      # auth.Middleware untuk cek token blocklist — key Redis yang sama
      # persis dengan yang dipakai auth-service ("revoked-jti:...").
      { name = "REDIS_HOST", value = aws_elasticache_cluster.main.cache_nodes[0].address },
      { name = "REDIS_PORT", value = tostring(aws_elasticache_cluster.main.cache_nodes[0].port) },
      # Alamat internal payment-service — dipanggil saat cache subscription
      # miss. Pakai service discovery DNS internal (Cloud Map) kalau sudah
      # di-setup; untuk MVP awal, isi manual atau lewat internal ALB listener.
      { name = "PAYMENT_SERVICE_URL", value = "http://payment-service.${var.project_name}-${var.environment}.local:3003" },
      # JWT_SECRET sengaja TIDAK di sini — HARUS diambil dari AWS Secrets
      # Manager lewat blok "secrets", dan HARUS berupa secret yang SAMA
      # PERSIS dengan yang dipakai auth-service. Kalau berbeda, semua
      # verifikasi token di media-service akan selalu gagal.
      # Private key untuk signing CloudFront URL sengaja TIDAK di sini —
      # ambil dari AWS Secrets Manager lewat blok "secrets" saat setup
      # produksi nyata (lihat catatan di README).
    ]
    logConfiguration = {
      logDriver = "awslogs"
      options = {
        "awslogs-group"         = "/ecs/${var.project_name}-${var.environment}/media-service"
        "awslogs-region"        = var.aws_region
        "awslogs-stream-prefix" = "ecs"
      }
    }
  }])
}

resource "aws_ecs_task_definition" "payment_service" {
  family                   = "${var.project_name}-${var.environment}-payment-service"
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = 256
  memory                   = 512
  execution_role_arn       = aws_iam_role.ecs_execution.arn
  task_role_arn            = aws_iam_role.payment_service_task.arn

  container_definitions = jsonencode([{
    name  = "payment-service"
    image = "${aws_ecr_repository.services["payment-service"].repository_url}:latest"
    portMappings = [{ containerPort = 3003, protocol = "tcp" }]
    environment = [
      { name = "DB_HOST", value = aws_db_instance.main.address },
      { name = "DB_NAME", value = var.db_name },
      { name = "DB_USER", value = var.db_username },
      { name = "REDIS_HOST", value = aws_elasticache_cluster.main.cache_nodes[0].address },
      { name = "REDIS_PORT", value = tostring(aws_elasticache_cluster.main.cache_nodes[0].port) },
      { name = "MIDTRANS_IS_PRODUCTION", value = var.environment == "production" ? "true" : "false" },
      # DB_PASSWORD, JWT_SECRET, MIDTRANS_SERVER_KEY, dan MIDTRANS_CLIENT_KEY
      # sengaja TIDAK di sini — ambil dari AWS Secrets Manager lewat blok
      # "secrets" saat setup produksi nyata. Server key Midtrans BUKAN
      # rahasia biasa — kalau bocor, orang lain bisa buat transaksi atas
      # nama akun Midtrans kamu.
    ]
    logConfiguration = {
      logDriver = "awslogs"
      options = {
        "awslogs-group"         = "/ecs/${var.project_name}-${var.environment}/payment-service"
        "awslogs-region"        = var.aws_region
        "awslogs-stream-prefix" = "ecs"
      }
    }
  }])
}

resource "aws_ecs_service" "auth_service" {
  name            = "auth-service"
  cluster         = aws_ecs_cluster.main.id
  task_definition = aws_ecs_task_definition.auth_service.arn
  desired_count   = 2 # minimal 2 task untuk high availability dasar
  launch_type     = "FARGATE"

  network_configuration {
    subnets         = aws_subnet.private[*].id
    security_groups = [aws_security_group.ecs_tasks.id]
  }
}

resource "aws_ecs_service" "catalog_service" {
  name            = "catalog-service"
  cluster         = aws_ecs_cluster.main.id
  task_definition = aws_ecs_task_definition.catalog_service.arn
  desired_count   = 2
  launch_type     = "FARGATE"

  network_configuration {
    subnets         = aws_subnet.private[*].id
    security_groups = [aws_security_group.ecs_tasks.id]
  }
}

resource "aws_ecs_service" "media_service" {
  name            = "media-service"
  cluster         = aws_ecs_cluster.main.id
  task_definition = aws_ecs_task_definition.media_service.arn
  desired_count   = 2
  launch_type     = "FARGATE"

  network_configuration {
    subnets         = aws_subnet.private[*].id
    security_groups = [aws_security_group.ecs_tasks.id]
  }
}

resource "aws_ecs_service" "payment_service" {
  name            = "payment-service"
  cluster         = aws_ecs_cluster.main.id
  task_definition = aws_ecs_task_definition.payment_service.arn
  desired_count   = 2
  launch_type     = "FARGATE"

  network_configuration {
    subnets         = aws_subnet.private[*].id
    security_groups = [aws_security_group.ecs_tasks.id]
  }

  # Daftarkan ke Cloud Map — inilah yang membuat
  # "payment-service.streaming-musik-dev.local" bisa di-resolve dari
  # dalam VPC (dipakai media-service, lihat env var PAYMENT_SERVICE_URL).
  service_registries {
    registry_arn = aws_service_discovery_service.payment_service.arn
  }
}

resource "aws_iam_role" "ecs_execution" {
  name = "${var.project_name}-${var.environment}-ecs-execution"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Action    = "sts:AssumeRole"
      Effect    = "Allow"
      Principal = { Service = "ecs-tasks.amazonaws.com" }
    }]
  })
}

resource "aws_iam_role_policy_attachment" "ecs_execution" {
  role       = aws_iam_role.ecs_execution.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy"
}

# Task role terpisah dari execution role: execution role dipakai ECS untuk
# pull image & tulis log, task role dipakai KODE DI DALAM container untuk
# memanggil AWS API. Hanya media-service yang butuh ini (baca/tulis S3
# untuk file audio, baca Secrets Manager untuk private key signing
# CloudFront) — service lain cukup pakai execution role saja.
resource "aws_iam_role" "media_service_task" {
  name = "${var.project_name}-${var.environment}-media-service-task"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Action    = "sts:AssumeRole"
      Effect    = "Allow"
      Principal = { Service = "ecs-tasks.amazonaws.com" }
    }]
  })
}

resource "aws_iam_role_policy" "media_service_s3" {
  name = "${var.project_name}-${var.environment}-media-service-s3"
  role = aws_iam_role.media_service_task.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect   = "Allow"
      Action   = ["s3:GetObject", "s3:PutObject"]
      Resource = "${aws_s3_bucket.audio.arn}/*"
    }]
  })
}

resource "aws_iam_role_policy" "media_service_secrets" {
  name = "${var.project_name}-${var.environment}-media-service-secrets"
  role = aws_iam_role.media_service_task.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect   = "Allow"
      Action   = ["secretsmanager:GetSecretValue"]
      # Batasi ke secret dengan prefix ini saat membuat secret-nya di Secrets Manager
      Resource = "arn:aws:secretsmanager:${var.aws_region}:*:secret:${var.project_name}-${var.environment}-media-service-*"
    }]
  })
}

# Task role untuk auth-service: satu-satunya izin yang dibutuhkan adalah
# kirim email lewat SES, untuk fitur reset password.
resource "aws_iam_role" "auth_service_task" {
  name = "${var.project_name}-${var.environment}-auth-service-task"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Action    = "sts:AssumeRole"
      Effect    = "Allow"
      Principal = { Service = "ecs-tasks.amazonaws.com" }
    }]
  })
}

resource "aws_iam_role_policy" "auth_service_ses" {
  name = "${var.project_name}-${var.environment}-auth-service-ses"
  role = aws_iam_role.auth_service_task.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect   = "Allow"
      Action   = ["ses:SendEmail", "ses:SendRawEmail"]
      Resource = "*" # SES tidak punya resource ARN granular untuk SendEmail biasa
    }]
  })
}

# Task role untuk payment-service: hanya butuh baca Secrets Manager untuk
# ambil Midtrans server key & client key saat startup.
resource "aws_iam_role" "payment_service_task" {
  name = "${var.project_name}-${var.environment}-payment-service-task"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Action    = "sts:AssumeRole"
      Effect    = "Allow"
      Principal = { Service = "ecs-tasks.amazonaws.com" }
    }]
  })
}

resource "aws_iam_role_policy" "payment_service_secrets" {
  name = "${var.project_name}-${var.environment}-payment-service-secrets"
  role = aws_iam_role.payment_service_task.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect   = "Allow"
      Action   = ["secretsmanager:GetSecretValue"]
      Resource = "arn:aws:secretsmanager:${var.aws_region}:*:secret:${var.project_name}-${var.environment}-payment-service-*"
    }]
  })
}
