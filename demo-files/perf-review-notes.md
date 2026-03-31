# Performance Review — Self-Assessment Notes

**Review Period:** H2 2024 (July–December)
**Name:** [Your Name]
**Role:** Senior Software Engineer, Backend Team
**Manager:** Lisa Chen

---

## Key Accomplishments

### 1. Migrated Payment Service to Event-Driven Architecture
- Led the migration from synchronous REST calls to Kafka-based event streaming
- Reduced p99 latency from 1200ms to 180ms (85% improvement)
- Zero downtime during migration — used dual-write pattern over 3 weeks
- Wrote the RFC, got buy-in from 3 teams, and drove implementation

### 2. Mentored Two Junior Engineers
- Ran weekly 1:1s with Priya and Marcus
- Priya shipped her first production feature independently by October
- Marcus improved PR review turnaround from 3 days to same-day
- Both rated me "exceptional" in peer feedback

### 3. On-Call Reliability Improvements
- Built automated runbooks that resolved 40% of common alerts without human intervention
- Reduced mean-time-to-resolution from 45min to 12min
- Authored post-mortem for the November payment outage — identified root cause (connection pool exhaustion) and implemented fix

### 4. Cross-Team API Standardization
- Proposed and drove adoption of shared API conventions across 4 backend services
- Created OpenAPI template repo used by 12 engineers
- Reduced integration bugs by ~30% (based on Jira ticket analysis)

---

## Peer Feedback Highlights

> "Always the first person to help debug production issues, even when it's not their service." — Devon R.

> "The Kafka migration was the smoothest infra change I've seen here. Really well planned." — Sarah K.

> "Sometimes takes on too much and could delegate more. But the quality is always high." — James L.

> "Wish they spoke up more in planning meetings — their ideas are good but they hold back." — Lisa C. (manager)

---

## Areas for Growth
- **Visibility:** Need to present work more broadly — did great work but leadership didn't always see it
- **Delegation:** Tendency to fix things myself instead of coaching others to do it
- **Strategic thinking:** Lisa wants me to think more about "what should we build next" vs. "how do we build this"
- **Public speaking:** Declined two conference talk invitations — should say yes next time

---

## Goals for H1 2025
1. Lead the database sharding project (Q1–Q2)
2. Give at least one internal tech talk
3. Write a blog post for the engineering blog
4. Delegate at least one major project to Priya or Marcus
5. Have a career conversation with Lisa about Staff Engineer path
