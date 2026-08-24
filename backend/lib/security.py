"""Auth (bcrypt + JWT httpOnly cookie), tenant scoping, and API-key encryption."""
import base64
import hashlib
import os
from datetime import datetime, timedelta, timezone
from typing import Any, Optional

import jwt
from cryptography.fernet import Fernet
from fastapi import Cookie, Depends, HTTPException
from passlib.context import CryptContext

from lib.db import db

SESSION_COOKIE = "aea_session"
_ALGO = "HS256"
_pwd = CryptContext(schemes=["bcrypt"], deprecated="auto", bcrypt__rounds=10)


def _jwt_secret() -> str:
    return os.environ.get("JWT_SECRET", "dev-insecure-jwt-secret")


def _fernet() -> Fernet:
    master = os.environ.get("APP_MASTER_KEY", "dev-insecure-master-key")
    digest = hashlib.sha256(master.encode("utf-8")).digest()
    return Fernet(base64.urlsafe_b64encode(digest))


def hash_password(raw: str) -> str:
    return _pwd.hash(raw[:72])


def verify_password(raw: str, hashed: str) -> bool:
    try:
        return _pwd.verify(raw[:72], hashed)
    except Exception:
        return False


def encrypt_secret(plaintext: str) -> str:
    return _fernet().encrypt(plaintext.encode("utf-8")).decode("utf-8")


def decrypt_secret(ciphertext: str) -> str:
    return _fernet().decrypt(ciphertext.encode("utf-8")).decode("utf-8")


def last4(plaintext: str) -> str:
    return plaintext[-4:] if len(plaintext) >= 4 else plaintext


def create_token(user_id: str, company_id: str, role: str) -> str:
    payload: dict[str, Any] = {
        "sub": user_id,
        "cid": company_id,
        "role": role,
        "exp": datetime.now(timezone.utc) + timedelta(days=7),
    }
    return jwt.encode(payload, _jwt_secret(), algorithm=_ALGO)


class CurrentUser:
    id: str
    company_id: str
    email: str
    role: str
    employee_code: Optional[str]

    def __init__(self, doc: dict[str, Any]) -> None:
        self.id = doc["id"]
        self.company_id = doc["company_id"]
        self.email = doc["email"]
        self.role = doc["role"]
        self.employee_code = doc.get("employee_code")


async def current_user(aea_session: Optional[str] = Cookie(default=None)) -> CurrentUser:
    if not aea_session:
        raise HTTPException(status_code=401, detail="Not authenticated")
    try:
        payload = jwt.decode(aea_session, _jwt_secret(), algorithms=[_ALGO])
    except Exception:
        raise HTTPException(status_code=401, detail="Invalid or expired session")
    doc = await db.users.find_one({"id": payload.get("sub")}, {"_id": 0})
    if not doc:
        raise HTTPException(status_code=401, detail="User no longer exists")
    return CurrentUser(doc)


async def require_admin(user: CurrentUser = Depends(current_user)) -> CurrentUser:
    if user.role != "company_admin":
        raise HTTPException(status_code=403, detail="Company admin role required")
    return user


async def require_employee(user: CurrentUser = Depends(current_user)) -> CurrentUser:
    if user.role != "employee":
        raise HTTPException(status_code=403, detail="Employee role required")
    return user
