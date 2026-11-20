# AWS network architecture

The [editable draw.io XML](network-architecture.drawio) uses the diagrams.net AWS 2019
`mxgraph.aws4` shape family. Open it with **File > Open from > Device** in diagrams.net,
enable the AWS 2019 library if requested, and export `network-architecture.png` beside it.
The PNG and deployment screenshots are owner-produced evidence. This Mermaid diagram is the

```mermaid
flowchart TB
    Client[Browser / signed wearable client]
    CF[CloudFront, global edge]
    Client -->|HTTPS TCP 443| CF
    subgraph Region["AWS Region ap-south-1, default"]
        S3[(Private S3 assets + OAC)]
        EB[EventBridge custom bus]
        SQS[SQS partner-events + activity-logged]
        DLQ[Matching DLQs, after 3 receives]
        DDB[(DynamoDB analytics)]
        ECR[ECR, seven immutable image repositories]
        SM[Secrets Manager]
        CW[CloudWatch logs, dashboard and alarms]
        SNS[SNS confirmed email]
        subgraph VPC["VPC 10.20.0.0/16"]
            IGW[Internet Gateway]
            subgraph AZA["AZ a, first available AZ"]
                subgraph PA["public-a 10.20.0.0/24"]
                    ALBA[ALB node a]
                    NAT[One NAT Gateway + EIP]
                end
                subgraph AA["app-a 10.20.10.0/24"]
                    ECSA[ECS placement: six APIs + web]
                    LA[Lambda ENI placement: two consumers]
                end
                subgraph DA["data-a 10.20.20.0/24"]
                    DBA[RDS eligible data subnet a]
                end
            end
            subgraph AZB["AZ b, second available AZ"]
                subgraph PB["public-b 10.20.1.0/24"]
                    ALBB[ALB node b, same ALB]
                end
                subgraph AB["app-b 10.20.11.0/24"]
                    ECSB[ECS alternate placement / scaling]
                    LB[Lambda alternate ENI placement]
                end
                subgraph DB["data-b 10.20.21.0/24"]
                    DBB[RDS eligible data subnet b]
                end
            end
            RDS[(One private RDS PostgreSQL instance, single AZ)]
            VPCE[S3 + DynamoDB Gateway endpoints, app route table]
            ALBA -->|HTTP TCP 47820 APIs, 47809 web| ECSA
            ALBB -->|HTTP TCP 47820 APIs, 47809 web| ECSB
            ECSA <-->|Internal HTTP TCP 47820, Cloud Map| ECSB
            LA -->|Internal HTTP TCP 47820| ECSA
            LB -->|Internal HTTP TCP 47820| ECSB
            ECSA -->|PostgreSQL TLS TCP 5432| RDS
            ECSB -->|PostgreSQL TLS TCP 5432| RDS
            DBA -. subnet-group placement, no network port .-> RDS
            DBB -. subnet-group placement, no standby .-> RDS
            ECSA -->|AWS APIs TCP 443; web ALB TCP 80| NAT
            ECSB -->|AWS APIs TCP 443; web ALB TCP 80| NAT
            LA -->|AWS APIs TCP 443| NAT
            LB -->|AWS APIs TCP 443| NAT
            NAT -->|Egress TCP 80/443| IGW
            ECSA -->|HTTPS TCP 443| VPCE
            ECSB -->|HTTPS TCP 443| VPCE
            LA -->|HTTPS TCP 443| VPCE
            LB -->|HTTPS TCP 443| VPCE
        end
        IGW -->|HTTPS TCP 443, PutEvents| EB
        IGW -->|HTTPS TCP 443, image pulls| ECR
        IGW -->|HTTPS TCP 443, secret injection| SM
        IGW -->|HTTPS TCP 443, logs| CW
        IGW -->|HTTP TCP 80, web API calls from NAT EIP| ALBA
        VPCE -->|HTTPS TCP 443| S3
        VPCE -->|HTTPS TCP 443| DDB
        EB -->|Managed delivery, no customer listener port| SQS
        SQS -->|Managed redrive, no customer listener port| DLQ
        SQS -->|Managed Lambda invocation, no inbound VPC port| LA
        SQS -->|Managed Lambda invocation, no inbound VPC port| LB
        CW -->|Managed alarm action, no customer listener port| SNS
    end
    CF -->|HTTPS TCP 443, static| S3
    CF -->|HTTP TCP 80, dynamic pages and APIs via IGW| ALBA
    CF -->|HTTP TCP 80, same ALB| ALBB
```

## Boundaries and routing

- CloudFront is global, outside both the VPC and regional boundary. S3, EventBridge, SQS,
  DynamoDB, ECR, Secrets Manager, CloudWatch and SNS are managed services outside the VPC.
  Lambda execution environments are AWS-managed; the diagram places their VPC ENIs in the
  app subnets, not a public Lambda listener. SQS polling/invocation is an AWS-managed path.
  are topology labels, not promises of particular account AZ mappings. ALB spans both public
  subnets. Seven ECS services each start with one task and can scale to three; the paired
  ECS/Lambda symbols show eligible placement, not duplicate deployments per AZ.
- RDS is one `db.t4g.micro` PostgreSQL 16 instance, not a Multi-AZ pair. Its subnet group spans
  data-a and data-b and AWS chooses its instance placement. There is no standby in this build.
- Public route table defaults to IGW; app defaults to one NAT in public-a; data has no default
  route. S3 and DynamoDB gateway endpoints associate with the app route table only. Other AWS
  API traffic uses NAT on 443. DNS uses the VPC resolver and Cloud Map `habitloop.local`.
- ALB SG accepts TCP 80 from the CloudFront origin-facing prefix list and the NAT EIP `/32`.
  It forwards 47820 to APIs and 47809 to web. App SG admits these from ALB and 47820 from
  itself; DB SG admits 5432 from app SG only. Each tier has a NACL, with explicit stateless
  reply ports 1024-65535. Data inbound is limited to 5432 from the app CIDRs.
- `/api/*/internal` routes return 404 at listener priority 1. Service rules preserve the path,
  while the default targets web. Web server API calls use NAT to the public ALB on 80;
  backend and Lambda calls use Cloud Map directly on 47820.
- EventBridge routes PartnerEventReceived and ActivityLogged to separate queues/consumers.
  Event-normalizer writes through Activity and Integration APIs; analytics-updater writes to
  DynamoDB through the endpoint. RecommendationAccepted has no configured consumer.
- Arrows give destination TCP ports, except managed delivery/placement arrows explicitly marked
  as having no customer listener. SG replies are stateful; NACLs need ephemeral return rules.

See [deployment and screenshot checklist](../deployment/README.md) for validation against AWS,
and the [application overview](../../README.md) for consistency and security trade-offs.
