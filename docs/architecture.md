# Architecture decision 001

Status: accepted for local foundation, 2026-09-16.

The user's action request is to develop and run the platform in a new Docker project. The attached master prompt is product reference, not independent authorisation to provision Azure, publish a service or access corporate data.

Use a modular monolith for the first local delivery: the Product Design React/Vite starter in `apps/web`, Express API and job runner in `services/api`, shared rules in `packages/domain`, PostgreSQL for state/queue/audit, and a separate persistent recording volume. The frontend uses the selected Meeting Desk direction plus calendar and split review flows. Phosphor icons and locally bundled Inter avoid external asset requests.

This simplifies local setup and preserves boundaries for later extraction into orchestrator, transcription, minutes and export services. Docker Compose has a dedicated project name, network and volumes. It does not modify existing platform containers.

The PostgreSQL application account owns this local schema. Service queries enforce organisation and explicit team/owner/reviewer access. Database row-level security is not implemented yet and is a production hardening item. Separate tests exercise tenant and scope negative cases.

Approved minutes cannot be edited through the API. New transcript corrections retain prior source versions and clear evidence verification. Optimistic revisions prevent silent overwrites. Jobs use PostgreSQL locks; the initial deployment is single-app-instance. A restart marks in-flight chargeable jobs failed and requires an explicit retry.

Local password sign-in exists as a bootstrap/recovery path. Microsoft sign-in requires provisioned external identities and company configuration. No Microsoft passwords are collected. API keys use AES-256-GCM and are never returned by settings reads. Recording files are private to the API but not application-encrypted at rest in this local build.

Before scale-out or production: migrate schema through numbered migrations, add RLS/non-owner runtime DB roles, isolate the worker, enforce transport encryption, add secret rotation and step-up authentication, deploy private encrypted object storage, define retention and legal holds, and run a formal threat model, provider contract, failover and load evaluation.
