# Service-to-service call (media-service -> payment-service) TIDAK lewat
# ALB — ALB itu untuk traffic dari luar (internet). Untuk panggilan internal
# antar-container di dalam VPC, kita pakai AWS Cloud Map: setiap ECS service
# dapat nama DNS internal (*.streaming-musik-dev.local) yang otomatis
# ter-update setiap kali task di-restart/di-scale, tanpa perlu hardcode IP.

resource "aws_service_discovery_private_dns_namespace" "internal" {
  name = "${var.project_name}-${var.environment}.local"
  vpc  = aws_vpc.main.id
}

resource "aws_service_discovery_service" "payment_service" {
  name = "payment-service"

  dns_config {
    namespace_id = aws_service_discovery_private_dns_namespace.internal.id
    dns_records {
      ttl  = 10
      type = "A"
    }
    routing_policy = "MULTIVALUE"
  }

  health_check_custom_config {
    failure_threshold = 1
  }
}
