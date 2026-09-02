from contextlib import asynccontextmanager
from fastapi import FastAPI, APIRouter, Request
from fastapi.responses import JSONResponse
from dotenv import load_dotenv
from starlette.middleware.cors import CORSMiddleware
import os
import logging
from pathlib import Path


ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')

# MongoDB connection
from lib.db import client, db  # noqa: E402
from routers.auth import router as auth_router  # noqa: E402
from routers.company import router as company_router  # noqa: E402
from routers.employee import router as employee_router  # noqa: E402
from routers.hr import router as hr_router  # noqa: E402


logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)


def _is_production() -> bool:
    return os.environ.get("ENV", "development").lower() == "production"


def _validate_production_config() -> None:
    if not _is_production():
        return
    weak_values = {
        "",
        "change-me",
        "change-me-jwt-secret",
        "change-me-app-master-key",
        "dev-insecure-jwt-secret",
        "dev-insecure-master-key",
    }
    for name in ("JWT_SECRET", "APP_MASTER_KEY"):
        value = os.environ.get(name, "").strip()
        if value in weak_values or value.startswith("change-me"):
            raise RuntimeError(f"{name} must be set to a strong non-placeholder value in production")
    if "*" in [o.strip() for o in os.environ.get("CORS_ORIGINS", "*").split(",")]:
        logger.warning("CORS_ORIGINS contains '*' while ENV=production; set explicit HTTPS origins.")
    os.environ["COOKIE_SECURE"] = "true"


@asynccontextmanager
async def lifespan(app: FastAPI):
    _validate_production_config()
    await db.users.create_index("email", unique=True)
    await db.users.create_index("company_id")
    await db.employees.create_index([("company_id", 1), ("employee_code", 1)])
    await db.api_keys.create_index("company_id")
    await db.mcp_tools.create_index("company_id")
    await db.mcp_tools.create_index([("company_id", 1), ("name", 1)], unique=True)
    await db.policies.create_index("company_id")
    await db.runs.create_index("company_id")
    await db.action_requests.create_index("company_id")
    await db.action_requests.create_index([("company_id", 1), ("status", 1)])
    await db.action_requests.create_index([("company_id", 1), ("employee_code", 1)])
    yield
    client.close()


app = FastAPI(lifespan=lifespan, title="Adaptive Enterprise Agent")

api_router = APIRouter(prefix="/api")


@api_router.get("/")
async def root():
    return {"message": "Adaptive Enterprise Agent API", "status": "ok"}


api_router.include_router(auth_router)
api_router.include_router(company_router)
api_router.include_router(employee_router)
api_router.include_router(hr_router)

app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=os.environ.get('CORS_ORIGINS', '*').split(','),
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.exception_handler(Exception)
async def unhandled_exception_handler(request: Request, exc: Exception) -> JSONResponse:
    logger.exception("Unhandled exception for %s %s", request.method, request.url.path)
    return JSONResponse(status_code=500, content={"detail": "Internal server error"})

# Include the router in the main app — must stay the last statement.
app.include_router(api_router)
