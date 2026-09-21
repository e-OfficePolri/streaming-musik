variable "aws_region" {
  description = "Region AWS tempat semua resource dibuat"
  type        = string
  default     = "ap-southeast-1" # Singapura — latency rendah untuk Indonesia
}

variable "project_name" {
  description = "Prefix nama untuk semua resource"
  type        = string
  default     = "streaming-musik"
}

variable "environment" {
  description = "Nama environment (dev/staging/production)"
  type        = string
  default     = "dev"
}

variable "vpc_cidr" {
  description = "CIDR block untuk VPC"
  type        = string
  default     = "10.0.0.0/16"
}

variable "db_instance_class" {
  description = "Instance class untuk RDS PostgreSQL"
  type        = string
  default     = "db.t4g.micro" # cukup untuk dev/MVP, naikkan untuk produksi
}

variable "db_name" {
  type    = string
  default = "streaming_musik"
}

variable "db_username" {
  type    = string
  default = "streaming"
}

variable "db_password" {
  description = "Password RDS — WAJIB di-override lewat terraform.tfvars atau -var, jangan commit ke git"
  type        = string
  sensitive   = true
}

variable "redis_node_type" {
  description = "Instance type untuk ElastiCache Redis"
  type        = string
  default     = "cache.t4g.micro"
}

variable "ses_from_email" {
  description = "Email pengirim untuk reset password, dsb — domainnya harus sudah diverifikasi di AWS SES console"
  type        = string
  default     = "no-reply@example.com" # WAJIB diganti ke domain asli sebelum production
}

variable "app_web_url" {
  description = "URL web app produksi — dipakai untuk menyusun link reset password di email"
  type        = string
  default     = "http://localhost:3000"
}
