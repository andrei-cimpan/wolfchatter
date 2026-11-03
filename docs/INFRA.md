# Wolfchatter: Infrastructure & Cost Estimate

How I would deploy Wolfchatter on AWS, with staging and production environments. This is a paper exercise: nothing is deployed. Estimated cost: **about $65/month for staging and about $405/month for production**, of which $80 is map tiles.

## Assumptions

- **Prices:** AWS us-east-1 on-demand list prices, 730 hours/month, checked on 31 Oct 2026 (see Sources). Frankfurt (eu-central-1) is roughly 15-20% higher on the lines I checked (ALB +20%, NAT +16%), so expect about +$50 on production infrastructure if deployed in the EU.
- **Launch load (production):** 50k monthly active users, about 3 sessions each, so **150k map loads/month**; about 15M HTTP requests/month; about 150 GB/month internet egress; about 2,000 concurrent SSE connections at peak.
- **Availability:** production runs across 2 availability zones with a Multi-AZ database. Staging is a single-AZ, scaled-down copy.
- **Containers:** ARM (Graviton) images on Fargate, on-demand, no reserved capacity or savings plans. The pipeline therefore builds for arm64.
- **Map tiles:** the app keeps Leaflet, which is free. Local development and staging keep its default public OpenStreetMap tiles, which need no key or account. Those tiles are not meant for production traffic, and access can be withdrawn without notice, so production points `NEXT_PUBLIC_MAP_TILE_URL` at a paid raster provider, with no code change. Assumed: **about 50 tiles per map load**. A full view takes about 30 tiles on a desktop and 12 on a phone, and panning and zooming add more. This is my estimate, not a measurement, and it is the least certain number here.

## Architecture

```
Users -> Route 53 -> assets.<domain>: CloudFront (static files; origin is the ALB)
                  -> <domain>: WAF -> ALB -> ECS Fargate (Next.js container, 2 AZs) -> RDS PostgreSQL (Multi-AZ)
                                             (REST + SSE; Postgres LISTEN/NOTIFY fans out new messages)
GitHub Actions -> ECR -> one-off ECS task (migrations) -> ECS rolling deploy      Terraform manages all of the above
```

CloudFront has its own subdomain because Route 53 cannot split traffic by path. It stays out of the API's path because the rate limiter takes the client IP from the rightmost `X-Forwarded-For` entry, which would then be CloudFront's.

## Deployment settings

**Needed before the first deploy; not built yet:**

- **RDS certificate:** RDS for PostgreSQL 15 and later requires TLS by default. The `pg` driver treats `sslmode=require` as `verify-full`, and the image does not contain the RDS CA, so a plain `sslmode=require` should fail with a certificate error (read from the driver's source, not run against RDS). Add the RDS CA bundle to the image and set `sslmode=verify-full&sslrootcert=<path>` in `DATABASE_URL`. The app's pool, `LISTEN`, and migrations all read that URL.
- **Static file location:** set `assetPrefix` in `next.config.ts` to the CloudFront domain, at build time. Without it the browser fetches static files from the ALB and CloudFront is never used.

**Settings to choose:**

| Setting | Value | Why |
|---|---|---|
| ALB health check | `GET /favicon.ico` | ECS replaces any task that fails its load balancer check, so checking `/health` would replace every task during a database outage, for nothing, since each recovers by itself. Measured on the production image with no database reachable: `/favicon.ico` 200, `/health` 503. The cost is that the check only proves the process is up, so a task that alone cannot reach the database keeps its traffic |
| `/health` | Post-deploy check and external monitor | It reports whether the database is reachable, and nothing acts on it automatically |
| Deregistration delay | 30 s, not the default 300 s | ECS waits for draining before sending SIGTERM, and SSE streams never finish by themselves, so the default would hold each old task for 5 minutes on every deploy. Clients reconnect and catch up |
| ECS stop timeout | 30 s (default) | Above the app's 2-second shutdown deadline, so the app exits by itself |
| ALB idle timeout | 60 s (default) | Above the 25-second SSE heartbeat, so streams are not cut |
| Migrations | `node scripts/migrate.mts` as a one-off ECS task | Runs once, before the new tasks start. The command is in the same image. A rolling deploy runs old and new code together, so migrations must work with both |
| Tile provider | Production: set `NEXT_PUBLIC_MAP_TILE_URL` and `NEXT_PUBLIC_MAP_ATTRIBUTION` when building the image. Staging: leave them unset | They are inlined in the browser bundle, so anything in the URL is public. Staging must stay at the light, human browsing that OpenStreetMap's tile policy allows, so load tests must not fetch its tiles |
| Images | One per environment, since their tiles differ | `NEXT_PUBLIC_MAP_*` are inlined at build time, so the staging image cannot be promoted to production. Build both from the same commit, and check after each production deploy that the map shows tiles, since staging never uses the paid provider |

## Cost table

| Component | Service chosen | Why | Staging $/mo | Production $/mo |
|---|---|---|---|---|
| App compute | ECS Fargate, ARM | No servers to manage; stateless container; about 20% cheaper than x86. Staging: 1 task (0.5 vCPU, 1 GB). Production: 2 tasks (1 vCPU, 2 GB), autoscaling | 14 | 58 |
| Load balancer | Application Load Balancer | TLS, health checks, and long-lived SSE connections; spans 2 AZs (includes its public IPv4 addresses) | 27 | 32 |
| Networking | NAT gateways (production), public subnets (staging) | Production tasks sit in private subnets, one NAT per AZ for resilience. Staging skips NAT to save about $66 and relies on locked-down security groups | 4 | 74 |
| Database | RDS for PostgreSQL | PostgreSQL 17, as in local dev; managed backups. Staging: db.t4g.micro single-AZ, 20 GB. Production: db.t4g.medium Multi-AZ, 50 GB gp3 | 14 | 106 |
| Web firewall | AWS WAF | Rate limiting and managed rules matter because posting is anonymous in v1. Not used in staging | 0 | 17 |
| Static assets | CloudFront | Caches the Next.js static files near users | 1 | 7 |
| Internet egress | ALB / AWS data transfer | JSON and SSE responses at $0.09/GB | 1 | 14 |
| Observability and misc | CloudWatch Logs, Secrets Manager, Route 53, ECR, S3 (Terraform state) | Logs, secrets, DNS, images, IaC state | 4 | 15 |
| Map tiles | Stadia Maps, Standard plan, with Leaflet (production); OpenStreetMap public tiles (staging) | Works through the existing tile setting; commercial use allowed. Staging's light use needs no key or plan | 0 | 80 |
| CI/CD and IaC | GitHub Actions, Terraform | Free for a public repo; OIDC deploys, no long-lived keys | 0 | 0 |
| **Total** | | | **about 65** | **about 405** |

Production infrastructure alone is about $323/month. The services listed under "Estimates" below were not re-checked against a price page.

## How the main numbers are calculated

- **Fargate (ARM):** $0.03238 per vCPU-hour and $0.00356 per GB-hour. Production: (1 vCPU + 2 GB) x 730 h x 2 tasks = $57.67. Staging: (0.5 vCPU + 1 GB) x 730 h = $14.42.
- **ALB:** $0.0225/hour plus $0.008 per LCU-hour. Production: $16.43 + 1.5 LCU ($8.76) + 2 public IPv4 at $3.65 each = $32.49. Staging: 0.5 LCU, same IPs = $26.65.
- **NAT:** $0.045/hour plus $0.045/GB. Production: 2 x $32.85 + 20 GB + 2 public IPv4 = $73.90.
- **RDS:** db.t4g.medium Multi-AZ at $0.130/hour = $94.90, plus 50 GB gp3 at $0.115/GB billed on both nodes = $11.50. Staging: db.t4g.micro at $0.016/hour = $11.68, plus 20 GB = $2.30.
- **WAF:** $5 web ACL + 3 rules at $1 (managed common rules, IP reputation, a per-IP rate limit) + 15M requests at $0.60 per million = $17.
- **Map tiles:** a raster tile costs 1 credit, and the Standard plan is $80 for 7.5M credits, then $0.02 per 1,000. 150k loads x 50 tiles = 7.5M credits = $80. At 100 tiles per load: 15M credits = $80 + $150 = $230.
- **Estimates (not re-checked):** CloudFront, CloudWatch Logs, Secrets Manager, Route 53, ECR, S3.

## What drives the cost

The database is the biggest line at $106, followed by map tiles at $80 and NAT gateways at $74. Infrastructure is about $323, and the database and NAT gateways make up more than half of that. Tiles grow fastest with users: at 1M monthly users (about 3M map loads, 150M credits) the Professional plan, $250 for 25M credits and then $0.015 per 1,000, would cost roughly $2,125/month.

## Path to millions of users

- **App tier:** autoscale Fargate on CPU and connection count. The container stores no data; only its rate-limit counters are per task, so the app's limit multiplies with the task count and the WAF rule is the real ceiling.
- **Database:** larger instance, a connection pooler (RDS Proxy or PgBouncer), and a read replica for message history. Move spatial queries to PostGIS with a GiST index. `LISTEN` must bypass the pooler: it pins an RDS Proxy session and does not work through PgBouncer's transaction mode. That needs a second URL setting, since the app has only `DATABASE_URL` today.
- **Real-time:** Postgres LISTEN/NOTIFY is fine early on. At high connection counts, move fan-out to Redis pub/sub (ElastiCache) or a dedicated WebSocket service.
- **Map API:** cache viewport responses at CloudFront with a short TTL, since many users look at the same areas. With CloudFront in front of the API, `client-ip.ts` must stop reading the rightmost `X-Forwarded-For` entry as the client, or all users behind one edge share a rate limit.
- **Tiles:** move to a higher plan and negotiate volume pricing, or self-host vector tiles (for example PMTiles on S3 behind CloudFront, rendered with MapLibre in place of Leaflet).

## Cost levers

- A 1-year reserved db.t4g.medium is about 30% cheaper than on-demand (list $32 vs $47 per month, single-AZ).
- Compute Savings Plans for the production Fargate tasks.
- Staging on Fargate Spot (about 70% cheaper per vCPU-hour) or scheduled shutdown outside working hours.
- VPC endpoints for ECR and CloudWatch to cut NAT data processing as traffic grows.

## Sources

Prices checked 31 Oct 2026:

- Fargate ARM and Spot rates: https://cloudchipr.com/blog/aws-fargate-pricing
- RDS PostgreSQL rates: https://infratally.com/articles/aws-rds-pricing-explained-2026/ and https://www.bytebase.com/dbcost/rds/compare/t-medium.md
- ALB, public IPv4, and Frankfurt uplift: https://cloudburn.io/blog/aws-elastic-load-balancing-pricing
- NAT gateway rates and Frankfurt uplift: https://cloudburn.io/blog/aws-nat-gateway-pricing
- Internet egress rate: https://www.opslyft.com/blog/aws-nat-gateway-cost
- WAF: https://aws.amazon.com/waf/pricing

Map tile prices checked 3 Nov 2026:

- Stadia Maps: https://stadiamaps.com/pricing/
- OpenStreetMap tile usage policy: https://operations.osmfoundation.org/policies/tiles/

Service behaviour checked 3 Nov 2026:

- ECS replaces a task that fails its load balancer check: https://aws.amazon.com/blogs/containers/a-deep-dive-into-amazon-ecs-task-health-and-task-replacement/
- Stopping a task, draining, and the deregistration delay: https://docs.aws.amazon.com/AmazonECS/latest/developerguide/task-lifecycle-explanation.html and https://docs.aws.amazon.com/AmazonECS/latest/developerguide/load-balancer-connection-draining.html
- RDS TLS default: https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/PostgreSQL.Concepts.General.SSL.html
- RDS Proxy pinning on `LISTEN`: https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/rds-proxy-pinning.html
