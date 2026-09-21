output "rds_endpoint" {
  description = "Endpoint untuk koneksi ke RDS PostgreSQL"
  value       = aws_db_instance.main.address
}

output "redis_endpoint" {
  description = "Endpoint untuk koneksi ke Redis"
  value       = aws_elasticache_cluster.main.cache_nodes[0].address
}

output "cloudfront_domain" {
  description = "Domain CloudFront untuk streaming audio"
  value       = aws_cloudfront_distribution.audio.domain_name
}

output "s3_audio_bucket" {
  description = "Nama bucket S3 tempat file audio disimpan"
  value       = aws_s3_bucket.audio.id
}

output "alb_dns_name" {
  description = "DNS name load balancer — arahkan domain kamu ke sini"
  value       = aws_lb.main.dns_name
}

output "ecr_repository_urls" {
  description = "URL ECR untuk push image Docker tiap service"
  value       = { for k, v in aws_ecr_repository.services : k => v.repository_url }
}
