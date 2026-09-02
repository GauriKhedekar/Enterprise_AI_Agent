"""Local MCP tool execution shims used by the pipeline and HR approval flow."""
from datetime import date
from typing import Any

from fastapi import HTTPException

from lib.db import db
from models.schemas import new_id, utcnow


def action_requires_approval(tool: dict[str, Any]) -> bool:
    if tool.get("kind") != "action":
        return False
    return bool(tool.get("requires_human_approval", True))


def default_requires_approval(kind: str, value: bool | None) -> bool:
    if kind != "action":
        return False
    return True if value is None else bool(value)


def validate_tool_args(schema: dict[str, Any], args: dict[str, Any]) -> None:
    """Minimal JSON-schema validation for the tool schemas supported by this app."""
    if not isinstance(args, dict):
        raise HTTPException(status_code=422, detail="Tool arguments must be an object")
    required = schema.get("required") or []
    properties = schema.get("properties") or {}
    for key in required:
        if key not in args or args[key] in (None, ""):
            raise HTTPException(status_code=422, detail=f"Missing required tool argument: {key}")
    for key, rules in properties.items():
        if key not in args or args[key] is None:
            continue
        value = args[key]
        expected = rules.get("type") if isinstance(rules, dict) else None
        if expected == "string" and not isinstance(value, str):
            raise HTTPException(status_code=422, detail=f"Tool argument {key} must be a string")
        if isinstance(rules, dict) and rules.get("format") == "date":
            try:
                date.fromisoformat(str(value)[:10])
            except ValueError:
                raise HTTPException(status_code=422, detail=f"Tool argument {key} must be an ISO date")


async def execute_action_tool(
    *, company_id: str, tool: dict[str, Any], args: dict[str, Any], actor: str
) -> dict[str, Any]:
    validate_tool_args(tool.get("input_schema") or {}, args)
    if tool.get("name") != "submit_wfh_request":
        raise HTTPException(status_code=400, detail="Unsupported action tool")

    employee_code = str(args.get("employee_id") or "")
    employee = await db.employees.find_one(
        {"company_id": company_id, "employee_code": employee_code}, {"_id": 0}
    )
    if not employee:
        raise HTTPException(status_code=404, detail="Employee not found for action tool")

    return {
        "id": new_id(),
        "tool_name": tool["name"],
        "employee_code": employee_code,
        "date": str(args.get("date"))[:10],
        "submitted_by": actor,
        "submitted_at": utcnow(),
        "status": "submitted",
    }
