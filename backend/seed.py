"""Idempotent demo seed: two companies (to prove tenant isolation), employees, policy, keys.

Run: cd /app/backend && python seed.py

Provider credentials are read from the environment (see .env.example) — never hardcoded,
because anything written here lands in git history permanently.
"""
import asyncio
import os
from datetime import date, timedelta
from pathlib import Path

from dotenv import load_dotenv

# this script runs standalone, so it must load .env itself (uvicorn does it in server.py)
load_dotenv(Path(__file__).parent / ".env")

from lib.db import db
from lib.security import encrypt_secret, hash_password, last4
from models.schemas import new_id, utcnow

TODAY = date.today()

DEMO = {
    "company": "Acme Robotics",
    "admin_email": "gauri.khedekar.entc.2023@vpkbiet.org",
    "admin_password": "admin123",
    "employee_email": "priya.sharma@acmerobotics.com",
    "employee_password": "employee123",
}

OTHER = {
    "company": "Northwind Labs",
    "admin_email": "admin@northwindlabs.com",
    "admin_password": "northwind123",
}

EMPLOYEES = [
    ("EMP-0001", "Priya Sharma", DEMO["employee_email"], "Engineering", 26, "active"),
    ("EMP-0002", "Daniel Okafor", "daniel.okafor@acmerobotics.com", "Engineering", 14, "active"),
    ("EMP-0003", "Mei Tanaka", "mei.tanaka@acmerobotics.com", "Finance", 8, "active"),
    ("EMP-0004", "Luis Ferreira", "luis.ferreira@acmerobotics.com", "Customer Success", 4, "probation"),
    ("EMP-0005", "Hannah Weber", "hannah.weber@acmerobotics.com", "People Ops", 2, "active"),
]

def _cred(env_name: str) -> str:
    """Read a demo provider credential from the environment.

    Credentials are NEVER hardcoded here — this file is committed to git, and a key in
    source is a key in history forever. Set these in backend/.env (gitignored).
    """
    return os.environ.get(env_name, "").strip()


# provider -> (label, env var holding the key, env var holding the endpoint or None)
CREDS = {
    "gemini": ("Gemini Production", "SEED_GEMINI_API_KEY", None),
    "qdrant": ("Qdrant EU Central", "SEED_QDRANT_API_KEY", "SEED_QDRANT_URL"),
    "pageindex": ("PageIndex Cloud", "SEED_PAGEINDEX_API_KEY", None),
}

LEAVE_POLICY = """# Leave and Attendance Policy

## 1. Annual Leave Entitlement
Full-time employees accrue **1.75 days of paid annual leave per completed month of
service**. Leave may be carried over to the following calendar year up to a maximum of
ten (10) days.

## 2. Probationary Restrictions
Employees serving a probationary period may not take paid annual leave. Probation ends
after three (3) months of continuous service unless extended in writing by People Ops.

## 3. Notice Requirements
Annual leave of three days or more requires fourteen (14) days notice. Single-day leave
requires forty-eight (48) hours notice. Emergency and bereavement leave are exempt from
notice requirements.
"""

WFH_POLICY = """# Work From Home Policy

## 1. General Allowance
All full-time employees of Acme Robotics may work from home for up to **two (2) days per
calendar week**, subject to manager approval and team coverage requirements. Requests must
be submitted at least 24 hours in advance through the compliance assistant.

## 2. Minimum Service Requirement
Eligibility for the general work-from-home allowance begins only after an employee has
completed a **minimum of six (6) months of continuous service**. Employees with fewer than
six months of service (including those on probation) are not eligible for recurring remote
work and must work on-site, except where clause 3 applies.

## 3. Exceptions
Medical accommodations, statutory caregiving leave, and company-declared facility closures
override clauses 1 and 2. Such exceptions require People Ops confirmation and are logged
against the employee record.

## 4. Equipment and Security
Remote work must be performed on company-issued hardware over a trusted network. Access to
customer data from personal devices is prohibited under the Information Security Policy.
"""

NORTHWIND_POLICY = """# Northwind Labs Travel Policy

Employees may book economy fares without pre-approval up to a 4-hour flight duration.
This document belongs to Northwind Labs and must never be visible to another tenant.
"""


def months_ago(n: int) -> str:
    return (TODAY - timedelta(days=int(n * 30.44))).isoformat()


async def upsert_company(name: str) -> str:
    doc = await db.companies.find_one({"name": name}, {"_id": 0})
    if doc:
        return doc["id"]
    cid = new_id()
    await db.companies.insert_one({"id": cid, "name": name, "created_at": utcnow()})
    return cid


async def upsert_user(company_id: str, email: str, role: str, password: str, employee_code=None) -> str:
    email = email.lower()
    existing = await db.users.find_one({"email": email}, {"_id": 0})
    payload = {
        "company_id": company_id,
        "role": role,
        "employee_code": employee_code,
        "password_hash": hash_password(password),
        "invite_token": None,
    }
    if existing:
        await db.users.update_one({"id": existing["id"]}, {"$set": payload})
        return existing["id"]
    uid = new_id()
    await db.users.insert_one({"id": uid, "email": email, "created_at": utcnow(), **payload})
    return uid


async def upsert_policy(company_id: str, title: str, content: str, backend: str) -> None:
    if await db.policies.find_one({"company_id": company_id, "title": title}):
        return
    await db.policies.insert_one(
        {
            "id": new_id(),
            "company_id": company_id,
            "title": title,
            "content": content,
            "retrieval_backend": backend,
            "created_at": utcnow(),
        }
    )


async def upsert_key(
    company_id: str, provider: str, label: str, value: str, created_by: str, endpoint=None
) -> None:
    payload = {
        "provider": provider,
        "label": label,
        "encrypted_value": encrypt_secret(value),
        "last_four": last4(value),
        "endpoint": endpoint,
        "created_by": created_by,
    }
    existing = await db.api_keys.find_one({"company_id": company_id, "provider": provider})
    if existing:
        await db.api_keys.update_one({"id": existing["id"]}, {"$set": payload})
        return
    await db.api_keys.insert_one(
        {
            "id": new_id(),
            "company_id": company_id,
            "created_at": utcnow(),
            "rotated_at": None,
            **payload,
        }
    )


async def upsert_mcp_tool(
    company_id: str,
    name: str,
    display_name: str,
    description: str,
    kind: str,
    server_url: str,
    input_schema: dict,
    created_by: str,
    enabled_for_employees: bool = True,
) -> None:
    payload = {
        "display_name": display_name,
        "description": description,
        "kind": kind,
        "server_url": server_url,
        "input_schema": input_schema,
        "created_by": created_by,
        "enabled_for_employees": enabled_for_employees,
    }
    existing = await db.mcp_tools.find_one({"company_id": company_id, "name": name})
    if existing:
        await db.mcp_tools.update_one({"id": existing["id"]}, {"$set": payload})
        return
    await db.mcp_tools.insert_one(
        {
            "id": new_id(),
            "company_id": company_id,
            "name": name,
            "created_at": utcnow(),
            **payload,
        }
    )


async def main() -> None:
    acme = await upsert_company(DEMO["company"])
    await upsert_user(acme, DEMO["admin_email"], "company_admin", DEMO["admin_password"])
    await upsert_user(acme, DEMO["employee_email"], "employee", DEMO["employee_password"], "EMP-0001")

    for code, name, email, dept, months, status in EMPLOYEES:
        joining = months_ago(months)
        payload = {
            "company_id": acme,
            "employee_code": code,
            "name": name,
            "email": email,
            "department": dept,
            "joining_date": joining,
            "service_months": months,
            "employment_status": status,
        }
        existing = await db.employees.find_one({"company_id": acme, "employee_code": code}, {"_id": 0})
        if existing:
            await db.employees.update_one({"id": existing["id"]}, {"$set": payload})
        else:
            await db.employees.insert_one({"id": new_id(), "created_at": utcnow(), **payload})

    await upsert_policy(acme, "Work From Home Policy", WFH_POLICY, "pageindex")
    await upsert_policy(acme, "Leave and Attendance Policy", LEAVE_POLICY, "qdrant")
    await upsert_mcp_tool(
        acme,
        "get_employee_details",
        "Get Employee Details",
        "Read-only HR directory lookup used for tenure, department, and employment status checks.",
        "read",
        "local://hr-mcp",
        {
            "type": "object",
            "properties": {"employee_id": {"type": "string"}},
            "required": ["employee_id"],
        },
        DEMO["admin_email"],
    )
    await upsert_mcp_tool(
        acme,
        "submit_wfh_request",
        "Submit WFH Request",
        "State-changing WFH request tool; the agent can use it only after an ALLOW decision.",
        "action",
        "local://hr-mcp",
        {
            "type": "object",
            "properties": {
                "employee_id": {"type": "string"},
                "date": {"type": "string", "format": "date"},
            },
            "required": ["employee_id", "date"],
        },
        DEMO["admin_email"],
    )

    seeded, skipped = [], []
    for provider, (label, key_env, endpoint_env) in CREDS.items():
        value = _cred(key_env)
        if not value:
            skipped.append(f"{provider} (set {key_env})")
            continue
        endpoint = _cred(endpoint_env) if endpoint_env else None
        await upsert_key(acme, provider, label, value, DEMO["admin_email"], endpoint)
        seeded.append(provider)

    # Second tenant — used to prove cross-company data is never reachable.
    north = await upsert_company(OTHER["company"])
    await upsert_user(north, OTHER["admin_email"], "company_admin", OTHER["admin_password"])
    await upsert_policy(north, "Northwind Travel Policy", NORTHWIND_POLICY, "qdrant")
    await upsert_mcp_tool(
        north,
        "get_employee_details",
        "Get Employee Details",
        "Read-only HR directory lookup scoped to Northwind Labs.",
        "read",
        "local://hr-mcp",
        {"type": "object", "properties": {"employee_id": {"type": "string"}}},
        OTHER["admin_email"],
    )
    existing = await db.employees.find_one({"company_id": north, "employee_code": "NW-0001"})
    if not existing:
        await db.employees.insert_one(
            {
                "id": new_id(),
                "company_id": north,
                "employee_code": "NW-0001",
                "name": "Owen Blake",
                "email": "owen.blake@northwindlabs.com",
                "department": "Research",
                "joining_date": months_ago(19),
                "service_months": 19,
                "employment_status": "active",
                "created_at": utcnow(),
            }
        )

    print("Seed complete.")
    print(f"  Admin    : {DEMO['admin_email']} / {DEMO['admin_password']} ({DEMO['company']})")
    print(f"  Employee : {DEMO['employee_email']} / {DEMO['employee_password']} ({DEMO['company']})")
    print(f"  Other co : {OTHER['admin_email']} / {OTHER['admin_password']} ({OTHER['company']})")
    print(f"  Providers: seeded={seeded or 'none'}")
    if skipped:
        print(f"             skipped={skipped}")
        print("             (the agent pipeline needs a Gemini key to run)")


if __name__ == "__main__":
    asyncio.run(main())
