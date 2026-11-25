# HabitLoop

HabitLoop is a multi-tenant habit tracker and community challenge platform for NAGP Case Study 1  
Users schedule activities, record progress, join challenges, also provides integration for wearables,  
and accept explainable schedule recommendations. Six Node.js 22 services use TypeScript, Fastify 5,  
Drizzle ORM over `pg` and TypeBox schemas. The frontend uses SvelteKit 2, Svelte 5  
runes, and Stencil web components. The seed, smoke, simulator and deployment helper scripts are  
TypeScript run with `tsx` through npm, so Docker Desktop and Node 22 are the only prerequisites.

## Deliverables

| # | Deliverable | Where it is |
|---|---|---|
| 1 | Source code (public GitHub repository) | <https://github.com/GITUSER0198/NAGP-habitloop-2026/tree/main> |
| 1 | Android phone and Wear OS watch apps (installable APKs) | [apk/habitloop-phone.apk](apk/habitloop-phone.apk), [apk/habitloop-wear.apk](apk/habitloop-wear.apk) |
| 2 | Architecture overview: system design and microservice interactions, including the Recommendation Service | [docs/architecture.md](docs/architecture.md) |
| 3 | Setup guide: run the app locally with Docker Compose | [docs/setup.md](docs/setup.md) |
| 4 | API documentation: OpenAPI (Swagger) specs and Postman collection, including Recommendation Service endpoints | [docs/api/README.md](docs/api/README.md), specs and collection in [docs/api/](docs/api/) |
| 5 | Walkthrough of the user journey | [docs/walkthrough.md](docs/walkthrough.md) |
| 6 | Network architecture diagram | [docs/diagrams/network-architecture.drawio.png](docs/diagrams/network-architecture.drawio.png) (editable source: [network-architecture.drawio](docs/diagrams/network-architecture.drawio)) |
| 7 | Cloud deployment documentation with screenshots | [docs/deployment/README.md](docs/deployment/README.md), screenshots in [docs/deployment/screenshots/](docs/deployment/screenshots/) |
| 8 | Demo recording | [demo/HabitLoop-demo-DhruvGoel.mp4](demo/HabitLoop-demo-DhruvGoel.mp4) (included in the submission zip; not stored in Git because of its size) |
