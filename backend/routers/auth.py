"""Auth: company signup, shared login, invite acceptance, session identity."""
import os
import secrets
from datetime import timedelta
from typing import Optional
from urllib.parse import urlsplit

from fastapi import APIRouter, Depends, HTTPException, Request, Response

from lib.db import db
from lib.security import (
    SESSION_COOKIE,
    CurrentUser,
    create_token,
    current_user,
    hash_password,
    verify_password,
)
from models.schemas import (
    InviteInfo,
    LoginRequest,
    Me,
    SetPasswordRequest,
    SignupRequest,
    new_id,
    utcnow,
)

router = APIRouter(prefix="/auth", tags=["auth"])

COOKIE_MAX_AGE = int(timedelta(days=7).total_seconds())


def _set_session(response: Response, user_id: str, company_id: str, role: str) -> None:
    secure_cookie = os.environ.get("COOKIE_SECURE", "false").lower() == "true"
    response.set_cookie(
        key=SESSION_COOKIE,
        value=create_token(user_id, company_id, role),
        httponly=True,
        secure=secure_cookie,
        samesite="none" if secure_cookie else "lax",
        max_age=COOKIE_MAX_AGE,
        path="/",
    )


@router.post("/signup", response_model=Me)
async def signup(payload: SignupRequest, response: Response) -> Me:
    email = payload.email.lower()
    if await db.users.find_one({"email": email}):
        raise HTTPException(status_code=409, detail="An account with this email already exists")

    company = {"id": new_id(), "name": payload.company_name.strip(), "created_at": utcnow()}
    await db.companies.insert_one(dict(company))

    user = {
        "id": new_id(),
        "company_id": company["id"],
        "email": email,
        "role": "company_admin",
        "employee_code": None,
        "password_hash": hash_password(payload.password),
        "invite_token": None,
        "created_at": utcnow(),
    }
    await db.users.insert_one(dict(user))
    _set_session(response, user["id"], company["id"], "company_admin")
    return Me(
        id=user["id"],
        company_id=company["id"],
        company_name=company["name"],
        email=email,
        role="company_admin",
        employee_code=None,
    )


@router.post("/login", response_model=Me)
async def login(payload: LoginRequest, response: Response) -> Me:
    doc = await db.users.find_one({"email": payload.email.lower()}, {"_id": 0})
    if not doc or not doc.get("password_hash") or not verify_password(payload.password, doc["password_hash"]):
        raise HTTPException(status_code=401, detail="Invalid email or password")
    company = await db.companies.find_one({"id": doc["company_id"]}, {"_id": 0})
    _set_session(response, doc["id"], doc["company_id"], doc["role"])
    return Me(
        id=doc["id"],
        company_id=doc["company_id"],
        company_name=(company or {}).get("name", "—"),
        email=doc["email"],
        role=doc["role"],
        employee_code=doc.get("employee_code"),
    )


@router.post("/logout")
async def logout(response: Response) -> dict[str, bool]:
    secure_cookie = os.environ.get("COOKIE_SECURE", "false").lower() == "true"
    response.delete_cookie(
        SESSION_COOKIE,
        path="/",
        samesite="none" if secure_cookie else "lax",
        secure=secure_cookie,
    )
    return {"ok": True}


@router.get("/me", response_model=Me)
async def me(user: CurrentUser = Depends(current_user)) -> Me:
    company = await db.companies.find_one({"id": user.company_id}, {"_id": 0})
    return Me(
        id=user.id,
        company_id=user.company_id,
        company_name=(company or {}).get("name", "—"),
        email=user.email,
        role=user.role,
        employee_code=user.employee_code,
    )


@router.get("/invite/{token}", response_model=InviteInfo)
async def invite_info(token: str) -> InviteInfo:
    doc = await db.users.find_one({"invite_token": token}, {"_id": 0})
    if not doc:
        raise HTTPException(status_code=404, detail="This invite link is invalid or already used")
    company = await db.companies.find_one({"id": doc["company_id"]}, {"_id": 0})
    return InviteInfo(
        email=doc["email"],
        company_name=(company or {}).get("name", "—"),
        employee_code=doc.get("employee_code") or "—",
    )


@router.post("/invite/accept", response_model=Me)
async def accept_invite(payload: SetPasswordRequest, response: Response) -> Me:
    doc = await db.users.find_one({"invite_token": payload.token}, {"_id": 0})
    if not doc:
        raise HTTPException(status_code=404, detail="This invite link is invalid or already used")
    await db.users.update_one(
        {"id": doc["id"]},
        {"$set": {"password_hash": hash_password(payload.password), "invite_token": None}},
    )
    company = await db.companies.find_one({"id": doc["company_id"]}, {"_id": 0})
    _set_session(response, doc["id"], doc["company_id"], doc["role"])
    return Me(
        id=doc["id"],
        company_id=doc["company_id"],
        company_name=(company or {}).get("name", "—"),
        email=doc["email"],
        role=doc["role"],
        employee_code=doc.get("employee_code"),
    )


def new_invite_token() -> str:
    return secrets.token_urlsafe(32)


def app_base_url(request: Optional[Request] = None) -> str:
    """Prefer the origin the request actually arrived from — APP_URL can hold a stale host."""
    if request is not None:
        origin = request.headers.get("origin") or ""
        if origin.startswith("http"):
            return origin.rstrip("/")
        referer = request.headers.get("referer") or ""
        if referer.startswith("http"):
            parts = urlsplit(referer)
            return f"{parts.scheme}://{parts.netloc}"
    return os.environ.get("APP_URL", "http://localhost:3000").rstrip("/")
