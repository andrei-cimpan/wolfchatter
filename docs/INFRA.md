# Wolfchatter: Infrastructure & Cost Estimate

How I would deploy Wolfchatter on AWS, with staging and production environments. This is a paper exercise: nothing is deployed. Estimated cost: **about $65/month for staging and about $775/month for production**, of which $450 is map tiles.

## Assumptions

- **Prices:** AWS us-east-1 on-demand list prices, 730 hours/month, checked on 31 Oct 2026 (see Sources). Frankfurt (eu-central-1) is roughly 15-20% higher on the lines I checked (ALB +20%, NAT +16%), so expect about +$50 on production infrastructure if deployed in the EU.
- **Launch load (production):** 50k monthly active users, about 3 sessions each, so **150k map loads/month**; about 15M HTTP requests/month; about 150 GB/month internet egress; about 2,000 concurrent SSE connections at peak.
- **Availability:** production runs across 2 availability zones with a Multi-AZ database. Staging is a single-AZ, scaled-down copy.
- **Containers:** ARM (Graviton) images on Fargate, on-demand, no reserved capacity or savings plans.
- **Map tiles:** v1 uses public OpenStreetMap tiles, which are not meant for production traffic, so production uses Mapbox (the v2 plan).

## Architecture

```
Users -> Route 53 -> CloudFront (static assets)
                  -> WAF -> ALB -> ECS Fargate (Next.js container, 2 AZs) -> RDS PostgreSQL (Multi-AZ)
                                   (REST + SSE; Postgres LISTEN/NOTIFY fans out new messages)
GitHub Actions -> ECR -> ECS rolling deploy      Terraform manages all of the above
```

The ALB idle timeout stays above the 25-second SSE heartbeat, so streams are not cut.

## Cost table

| Component | Service chosen | Why | Staging $/mo | Production $/mo |
|---|---|---|---|---|
| App compute | ECS Fargate, ARM | No servers to manage; stateless container; about 20% cheaper than x86. Staging: 1 task (0.5 vCPU, 1 GB). Production: 2 tasks (1 vCPU, 2 GB), autoscaling | 14 | 58 |
| Load balancer | Application Load Balancer | TLS, health checks, and long-lived SSE connections; spans 2 AZs (includes its public IPv4 addresses) | 27 | 32 |
| Networking | NAT gateways (production), public subnets (staging) | Production tasks sit in private subnets, one NAT per AZ for resilience. Staging skips NAT to save about $66 and relies on locked-down security groups | 4 | 74 |
| Database | RDS for PostgreSQL | Same engine as local dev; managed backups. Staging: db.t4g.micro single-AZ, 20 GB. Production: db.t4g.medium Multi-AZ, 50 GB gp3 | 14 | 106 |
| Web firewall | AWS WAF | Rate limiting and managed rules matter because posting is anonymous in v1. Not used in staging | 0 | 17 |
| Static assets | CloudFront | Caches the Next.js static files near users | 1 | 7 |
| Internet egress | ALB / AWS data transfer | JSON and SSE responses at $0.09/GB | 1 | 14 |
| Observability and misc | CloudWatch Logs, Secrets Manager, Route 53, ECR, S3 (Terraform state) | Logs, secrets, DNS, images, IaC state | 4 | 15 |
| Map tiles | Mapbox GL JS | Managed vector tiles; staging stays inside the free tier | 0 | 450 |
| CI/CD and IaC | GitHub Actions, Terraform | Free for a public repo; OIDC deploys, no long-lived keys | 0 | 0 |
| **Total** | | | **about 65** | **about 775** |

Production infrastructure alone is about $323/month. Rows marked "estimate" below were not re-checked against a price page.

## How the main numbers are calculated

- **Fargate (ARM):** $0.03238 per vCPU-hour and $0.00356 per GB-hour. Production: (1 vCPU + 2 GB) x 730 h x 2 tasks = $57.67. Staging: (0.5 vCPU + 1 GB) x 730 h = $14.42.
- **ALB:** $0.0225/hour plus $0.008 per LCU-hour. Production: $16.43 + 1.5 LCU ($8.76) + 2 public IPv4 at $3.65 each = $32.49. Staging: 0.5 LCU, same IPs = $26.65.
- **NAT:** $0.045/hour plus $0.045/GB. Production: 2 x $32.85 + 20 GB + 2 public IPv4 = $73.90.
- **RDS:** db.t4g.medium Multi-AZ at $0.130/hour = $94.90, plus 50 GB gp3 at $0.115/GB billed on both nodes = $11.50. Staging: db.t4g.micro at $0.016/hour = $11.68, plus 20 GB = $2.30.
- **WAF:** $5 web ACL + 3 rules at $1 (managed common rules, IP reputation, a per-IP rate limit) + 15M requests at $0.60 per million = $17.
- **Mapbox:** 50k free map loads, then $5 per 1,000 up to 100k and $4 per 1,000 up to 200k. 150k loads = $250 + $200 = $450.
- **Estimates (not re-checked):** CloudFront, CloudWatch Logs, Secrets Manager, Route 53, ECR, S3.

## What drives the cost

Map tiles are the biggest line: $450 of the $775. Infrastructure is about $323, and the database and NAT gateways make up more than half of that. At 1M monthly users (about 3M map loads) the same Mapbox tiers would cost roughly $8,050/month, far more than all other infrastructure combined.

## Path to millions of users

- **App tier:** autoscale Fargate on CPU and connection count; the container is already stateless.
- **Database:** larger instance, a connection pooler (RDS Proxy or PgBouncer), and a read replica for message history. Move spatial queries to PostGIS with a GiST index.
- **Real-time:** Postgres LISTEN/NOTIFY is fine early on. At high connection counts, move fan-out to Redis pub/sub (ElastiCache) or a dedicated WebSocket service.
- **Map API:** cache viewport responses at CloudFront with a short TTL, since many users look at the same areas.
- **Tiles:** negotiate Mapbox volume pricing, or self-host vector tiles (for example PMTiles on S3 behind CloudFront, rendered with MapLibre).
- **v2 alternative:** hosted Supabase would replace RDS and the custom real-time layer. It is not priced here.

## Cost levers

- A 1-year reserved db.t4g.medium is about 30% cheaper than on-demand (list $32 vs $47 per month, single-AZ).
- Compute Savings Plans for the production Fargate tasks.
- Staging on Fargate Spot (about 70% cheaper per vCPU-hour) or scheduled shutdown outside working hours.
- VPC endpoints for ECR and CloudWatch to cut NAT data processing as traffic grows.

## Sources

Checked 31 Oct 2026.

- Fargate ARM and Spot rates: https://cloudchipr.com/blog/aws-fargate-pricing
- RDS PostgreSQL rates: https://infratally.com/articles/aws-rds-pricing-explained-2026/ and https://www.bytebase.com/dbcost/rds/compare/t-medium.md
- ALB, public IPv4, and Frankfurt uplift: https://cloudburn.io/blog/aws-elastic-load-balancing-pricing
- NAT gateway rates and Frankfurt uplift: https://cloudburn.io/blog/aws-nat-gateway-pricing
- Internet egress rate: https://www.opslyft.com/blog/aws-nat-gateway-cost
- WAF: https://aws.amazon.com/waf/pricing
- Mapbox: https://www.mapbox.com/pricing and https://superdupr.com/blog/mapbox-pricing
