"""Guardrail unit tests — the plain-code layers that must not depend on LLM cooperation."""
import pytest

from lib.pipeline import _detect_pii_leak, validate_citations


EVIDENCE = [
    {
        "source": "Work From Home Policy > 2. Minimum Service Requirement",
        "text": (
            "Eligibility for the general work-from-home allowance begins only after an "
            "employee has completed a minimum of six (6) months of continuous service."
        ),
    },
    {"source": "HR record EMP-0001", "text": "employee_code: EMP-0001; service_months: 26"},
]


class TestCitationValidation:
    def test_verbatim_citation_is_kept(self):
        kept, stripped = validate_citations(
            ["an employee has completed a minimum of six (6) months of continuous service"],
            EVIDENCE,
        )
        assert len(kept) == 1
        assert stripped == []
        assert kept[0]["source"].startswith("Work From Home Policy")

    def test_fabricated_citation_is_stripped(self):
        kept, stripped = validate_citations(
            ["Employees may work remotely five days a week with no service requirement."],
            EVIDENCE,
        )
        assert kept == []
        assert len(stripped) == 1

    def test_mixed_citations_partially_stripped(self):
        kept, stripped = validate_citations(
            [
                "employee has completed a minimum of six (6) months of continuous service",
                "Salaries are reviewed every quarter by the board.",
            ],
            EVIDENCE,
        )
        assert len(kept) == 1
        assert len(stripped) == 1

    def test_empty_and_blank_claims_ignored(self):
        kept, stripped = validate_citations(["", "   "], EVIDENCE)
        assert kept == [] and stripped == []


@pytest.mark.asyncio
class TestPiiLeakDetection:
    """_detect_pii_leak must catch another employee's identity in the final answer.

    Each test gets its own motor client bound to the running event loop and patched over
    `lib.pipeline.db` — the module-level handle is bound to uvicorn's long-lived loop,
    which pytest's per-test loops cannot reuse.
    """

    async def _seed(self, monkeypatch):
        import os

        import lib.pipeline as pipeline
        from motor.motor_asyncio import AsyncIOMotorClient

        client = AsyncIOMotorClient(os.environ.get("MONGO_URL", "mongodb://localhost:27017"))
        db = client[os.environ.get("DB_NAME", "app")]
        monkeypatch.setattr(pipeline, "db", db)

        await db.employees.delete_many({"company_id": "co-test"})
        await db.employees.insert_many(
            [
                {
                    "id": "e1", "company_id": "co-test", "employee_code": "EMP-0001",
                    "name": "Priya Sharma", "email": "priya.sharma@acmerobotics.com",
                    "department": "Engineering", "joining_date": "2024-01-01",
                    "service_months": 26, "employment_status": "active",
                },
                {
                    "id": "e2", "company_id": "co-test", "employee_code": "EMP-0003",
                    "name": "Mei Tanaka", "email": "mei.tanaka@acmerobotics.com",
                    "department": "Finance", "joining_date": "2025-06-01",
                    "service_months": 8, "employment_status": "active",
                },
            ]
        )
        return client

    async def test_detects_other_employee_email(self, monkeypatch):
        client = await self._seed(monkeypatch)
        try:
            found = await _detect_pii_leak(
                "You can reach her at mei.tanaka@acmerobotics.com for coverage.",
                "co-test", "EMP-0001",
            )
            assert any("EMP-0003" in f for f in found), found
        finally:
            client.close()

    async def test_detects_other_employee_full_name(self, monkeypatch):
        client = await self._seed(monkeypatch)
        try:
            found = await _detect_pii_leak(
                "Mei Tanaka has 8 months of service and is therefore eligible.",
                "co-test", "EMP-0001",
            )
            assert any("EMP-0003" in f for f in found), found
        finally:
            client.close()

    async def test_requesters_own_identity_is_not_a_leak(self, monkeypatch):
        client = await self._seed(monkeypatch)
        try:
            found = await _detect_pii_leak(
                "Priya Sharma, you have 26 months of service and are eligible.",
                "co-test", "EMP-0001",
            )
            assert found == [], found
        finally:
            client.close()

    async def test_employee_code_only_answer_is_clean(self, monkeypatch):
        client = await self._seed(monkeypatch)
        try:
            found = await _detect_pii_leak(
                "Yes, EMP-0003 is eligible to work remotely up to two days a week.",
                "co-test", "EMP-0001",
            )
            assert found == [], found
        finally:
            client.close()

    async def test_empty_answer_is_clean(self, monkeypatch):
        client = await self._seed(monkeypatch)
        try:
            assert await _detect_pii_leak("", "co-test", "EMP-0001") == []
        finally:
            client.close()
