# Bucket audio TIDAK public — akses hanya lewat CloudFront dengan signed URL,
# supaya file audio tidak bisa didownload langsung lewat URL S3 mentah
# (penting untuk kepatuhan lisensi label).
resource "aws_s3_bucket" "audio" {
  bucket = "${var.project_name}-${var.environment}-audio"

  tags = {
    Name = "${var.project_name}-${var.environment}-audio"
  }
}

resource "aws_s3_bucket_public_access_block" "audio" {
  bucket                  = aws_s3_bucket.audio.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

# Origin Access Control — mekanisme resmi AWS supaya hanya CloudFront
# (bukan siapa pun yang tahu URL S3) yang boleh baca isi bucket.
resource "aws_cloudfront_origin_access_control" "audio" {
  name                              = "${var.project_name}-${var.environment}-audio-oac"
  origin_access_control_origin_type = "s3"
  signing_behavior                  = "always"
  signing_protocol                  = "sigv4"
}

resource "aws_cloudfront_distribution" "audio" {
  enabled = true
  comment = "${var.project_name}-${var.environment} audio CDN"

  origin {
    domain_name              = aws_s3_bucket.audio.bucket_regional_domain_name
    origin_id                = "audio-s3-origin"
    origin_access_control_id = aws_cloudfront_origin_access_control.audio.id
  }

  default_cache_behavior {
    allowed_methods        = ["GET", "HEAD"]
    cached_methods         = ["GET", "HEAD"]
    target_origin_id       = "audio-s3-origin"
    viewer_protocol_policy = "redirect-to-https"

    # Signed URL per-request dihasilkan oleh media-service (lihat
    # services/media-service) sebelum dikirim ke client — CloudFront
    # menolak request tanpa signature valid berkat trusted_key_groups.
    trusted_key_groups = [aws_cloudfront_key_group.signing.id]

    forwarded_values {
      query_string = false
      cookies {
        forward = "none"
      }
    }

    min_ttl     = 0
    default_ttl = 86400  # 1 hari — file audio jarang berubah setelah upload
    max_ttl     = 604800 # 7 hari
  }

  restrictions {
    geo_restriction {
      restrict_type = "none" # atur per-track lewat tabel LICENSES, bukan di sini
    }
  }

  viewer_certificate {
    cloudfront_default_certificate = true
  }

  tags = {
    Name = "${var.project_name}-${var.environment}-audio-cdn"
  }
}

# Public key untuk memverifikasi signed URL yang dibuat media-service.
# Generate keypair dengan: openssl genrsa -out private_key.pem 2048
#                          openssl rsa -pubout -in private_key.pem -out public_key.pem
# Private key TIDAK disimpan di Terraform — simpan di AWS Secrets Manager
# dan berikan ke media-service lewat environment variable saat deploy.
resource "aws_cloudfront_public_key" "signing" {
  name        = "${var.project_name}-${var.environment}-signing-key"
  comment     = "Public key untuk verifikasi signed URL streaming audio"
  encoded_key = file("${path.module}/cloudfront_public_key.pem") # siapkan file ini sebelum apply
}

resource "aws_cloudfront_key_group" "signing" {
  name    = "${var.project_name}-${var.environment}-signing-group"
  items   = [aws_cloudfront_public_key.signing.id]
  comment = "Key group untuk signed URL media-service"
}

resource "aws_s3_bucket_policy" "audio_cloudfront_only" {
  bucket = aws_s3_bucket.audio.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Sid       = "AllowCloudFrontServicePrincipal"
      Effect    = "Allow"
      Principal = { Service = "cloudfront.amazonaws.com" }
      Action    = "s3:GetObject"
      Resource  = "${aws_s3_bucket.audio.arn}/*"
      Condition = {
        StringEquals = {
          "AWS:SourceArn" = aws_cloudfront_distribution.audio.arn
        }
      }
    }]
  })
}
