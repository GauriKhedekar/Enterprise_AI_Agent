"""Auth contract for the documented demo credentials."""

import pytest

from lib.security import hash_password
from models.schemas import new_id, utcnow


@pytest.mark.asyncio
async def test_demo_employee_credentials_are_valid(monkeypatch):
    import routers.auth as auth
    from motor.motor_asyncio import AsyncIOMotorClient

    import os

    client = AsyncIOMotorClient(os.environ.get("MONGO_URL", "mongodb://localhost:27017"))
    test_db = client[os.environ.get("DB_NAME", "app")]
    monkeypatch.setattr(auth, "db", test_db)

    company_id = new_id()
    user_id = new_id()
    email = "priya.sharma@acmerobotics.com"

    try:
        await test_db.companies.insert_one(
            {"id": company_id, "name": "Acme Robotics", "created_at": utcnow()}
        )
        await test_db.users.insert_one(
            {
                "id": user_id,
                "company_id": company_id,
                "email": email,
                "role": "employee",
                "employee_code": "EMP-0001",
                "password_hash": hash_password("employee123"),
                "invite_token": None,
                "created_at": utcnow(),
            }
        )

        from fastapi import Response
        from models.schemas import LoginRequest

        me = await auth.login(LoginRequest(email=email, password="employee123"), Response())
        assert me.email == email
        assert me.role == "employee"
        assert me.employee_code == "EMP-0001"
    finally:
        await test_db.users.delete_many({"company_id": company_id})
        await test_db.companies.delete_many({"id": company_id})
        client.close()
