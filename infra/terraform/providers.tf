terraform {
  required_version = ">= 1.7.0"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }

  # Simpan state Terraform di S3, bukan lokal — supaya aman dipakai tim
  # dan tidak hilang. Buat bucket ini manual sekali di awal (di luar Terraform),
  # lalu isi nilai di bawah.
  backend "s3" {
    bucket = "streaming-musik-terraform-state" # ganti sesuai nama bucket kamu
    key    = "global/terraform.tfstate"
    region = "ap-southeast-1"
  }
}

provider "aws" {
  region = var.aws_region
}
