"""
Tax Optimization Web Application
--------------------------------

This FastAPI application wraps the tax calculation logic provided in
``taxclaude.py`` and exposes a simple HTML form for the user, their spouse,
and any children.  All of the fields defined on the ``PersonalTaxData`` and
``FamilyTaxData`` dataclasses are surfaced in the form.  Upon submission the
application constructs the appropriate data structures, invokes the tax
calculator and, if a spouse is present, runs a basic optimization routine on
RRSP contributions to maximize after‑tax income.  The results and the
recommended RRSP allocation are then rendered back to the user.

The application uses only built‑in and pre‑installed packages (FastAPI,
Jinja2, and Uvicorn) because third‑party UI frameworks like Streamlit or
Gradio are not available in this environment.
"""

from fastapi import FastAPI, Form, Request
from fastapi.responses import HTMLResponse
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates
from typing import Any, Dict, List, Optional, Tuple, Union, get_args, get_origin
from dataclasses import fields as dataclass_fields
import inspect
import os
import json
from datetime import datetime, timezone

# Import the tax calculation classes from the provided script
# Ensure our module can be imported when running outside of the package context.
import sys
# Determine where the original taxclaude.py lives.  The app.py file may be nested
# relative to the root of the repository.  Search upwards for ``taxclaude.py`` and
# add that directory to ``sys.path`` so that the module can be imported.
MODULE_DIR = os.path.dirname(os.path.abspath(__file__))

search_dir = MODULE_DIR
found_tax = False
for _ in range(10):
    candidate = os.path.join(search_dir, "taxclaude.py")
    if os.path.exists(candidate):
        if search_dir not in sys.path:
            sys.path.insert(0, search_dir)
        found_tax = True
        break
    parent = os.path.dirname(search_dir)
    if parent == search_dir:
        break
    search_dir = parent

if not found_tax:
    # As a fallback, append the module directory itself.
    if MODULE_DIR not in sys.path:
        sys.path.append(MODULE_DIR)

import taxclaude

app = FastAPI(title="Canadian Tax Optimizer", description="Calculate and optimize taxes for individuals and spouses in Canada.")

# Configure Jinja2 templates
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
templates = Jinja2Templates(directory=os.path.join(BASE_DIR, "templates"))
LAST_SUBMISSION_PATH = os.path.join(BASE_DIR, "last_submission.json")


def get_person_fields() -> List[Tuple[str, type, Any]]:
    """Return a list of (field_name, field_type, default_value) for PersonalTaxData."""
    result = []
    for f in dataclass_fields(taxclaude.PersonalTaxData):
        # Skip internal fields that we shouldn't expose
        # The 'is_spouse' flag is handled via the FamilyTaxData.has_spouse
        if f.name == "is_spouse":
            continue
        result.append((f.name, f.type, f.default))
    return result


def get_family_fields() -> List[Tuple[str, type, Any]]:
    """Return a list of (field_name, field_type, default_value) for FamilyTaxData excluding taxpayer/spouse."""
    result = []
    for f in dataclass_fields(taxclaude.FamilyTaxData):
        if f.name in {"taxpayer", "spouse"}:
            continue
        result.append((f.name, f.type, f.default))
    return result


def parse_bool(value: Optional[str]) -> bool:
    """Parse a checkbox value into a boolean."""
    if value is None:
        return False
    if isinstance(value, bool):
        return value
    return str(value).strip().lower() in {"on", "true", "1", "yes", "y"}


def parse_list_of_ints(value: str) -> List[int]:
    """Parse a comma‑separated string into a list of ints."""
    if not value:
        return []
    return [int(x.strip()) for x in value.split(",") if x.strip()]


def save_last_submission(params: Dict[str, str]) -> str:
    saved_at = datetime.now(timezone.utc).isoformat()
    payload = {"saved_at": saved_at, "params": dict(params)}
    with open(LAST_SUBMISSION_PATH, "w") as handle:
        json.dump(payload, handle, indent=2, sort_keys=True)
    return saved_at


def load_last_submission() -> Optional[Dict[str, Any]]:
    if not os.path.exists(LAST_SUBMISSION_PATH):
        return None
    try:
        with open(LAST_SUBMISSION_PATH, "r") as handle:
            return json.load(handle)
    except Exception:
        return None


def build_input_url(params: Dict[str, str]) -> str:
    from urllib.parse import urlencode

    query = urlencode(params)
    return f"/calculate?{query}" if query else "/calculate"


def unwrap_optional(ftype: type) -> Tuple[bool, type]:
    """Return (is_optional, inner_type) for typing.Optional/Union types."""
    origin = get_origin(ftype)
    if origin is None:
        return False, ftype
    if origin is Optional:
        args = get_args(ftype)
        return True, args[0] if args else Any
    if origin is Union:
        args = [arg for arg in get_args(ftype) if arg is not type(None)]
        if len(args) == 1:
            return True, args[0]
    return False, ftype


@app.get("/", response_class=HTMLResponse)
async def index(request: Request) -> HTMLResponse:
    """Render the main form with all available fields."""
    person_fields_raw = get_person_fields()
    family_fields = get_family_fields()
    saved = load_last_submission()
    saved_params: Dict[str, str] = {}
    if saved and isinstance(saved.get("params"), dict):
        saved_params = saved["params"]
    # Prepare person fields for display in Jinja2 by annotating the Python type as a simple string
    person_fields: List[Tuple[str, str, Any]] = []
    for name, ftype, default in person_fields_raw:
        # Determine a string representation for the field type
        type_name = "str"
        try:
            is_optional, inner_type = unwrap_optional(ftype)
            check_type = inner_type if is_optional else ftype
            if check_type is bool:
                type_name = "bool"
            elif check_type is int:
                type_name = "int"
            elif check_type is float:
                type_name = "float"
        except Exception:
            type_name = "str"
        person_fields.append((name, type_name, default))
    return templates.TemplateResponse(
        "index.html",
        {
            "request": request,
            "person_fields": person_fields,
            "family_fields": family_fields,
            "saved_params": saved_params,
        },
    )


def calculate_from_params(request: Request, params: Dict[str, str], saved_at: Optional[str] = None) -> HTMLResponse:
    """Compute results from a parameter dictionary and render them."""
    # Extract family-related parameters
    has_spouse_raw = params.get("has_spouse")
    num_children_raw = params.get("num_children", "0")
    children_ages_raw = params.get("children_ages", "")
    children_disability_raw = params.get("children_with_disability", "")
    resp_contributions_raw = params.get("resp_contributions", "0")
    eligible_dependant_raw = params.get("eligible_dependant")
    caregiver_amount_raw = params.get("canada_caregiver_amount", "0")

    # Prepare dictionaries for taxpayer and spouse
    tp_data_kwargs: Dict[str, Any] = {}
    sp_data_kwargs: Dict[str, Any] = {}

    person_fields = get_person_fields()
    person_field_names = [name for name, _, _ in person_fields]

    for key in params:
        val = params.get(key)
        if key.startswith("tp_"):
            field_name = key[3:]
            if field_name in person_field_names:
                tp_data_kwargs[field_name] = val
        elif key.startswith("sp_"):
            field_name = key[3:]
            if field_name in person_field_names:
                sp_data_kwargs[field_name] = val

    def cast_value(field_type: type, value: str):
        """Cast a string value into the appropriate Python type."""
        is_optional, inner_type = unwrap_optional(field_type)
        if value is None:
            return None
        if isinstance(value, str):
            stripped = value.strip()
            if stripped == "" or stripped.lower() == "none":
                return None
        try:
            if inner_type == bool:
                return parse_bool(value)
            if inner_type == int:
                return int(value)
            if inner_type == float:
                return float(value)
            return value
        except Exception:
            return None

    # Build taxpayer data
    tp_init: Dict[str, Any] = {}
    for name, ftype, default in person_fields:
        raw = tp_data_kwargs.get(name, "")
        if ftype == bool:
            tp_init[name] = parse_bool(raw)
        else:
            tp_init[name] = cast_value(ftype, raw)
        if tp_init[name] is None:
            tp_init[name] = default
    taxpayer = taxclaude.PersonalTaxData(**tp_init)

    # Build spouse data if indicated
    spouse_exists = parse_bool(has_spouse_raw)
    spouse = None
    if spouse_exists:
        sp_init: Dict[str, Any] = {}
        for name, ftype, default in person_fields:
            raw = sp_data_kwargs.get(name, "")
            if ftype == bool:
                sp_init[name] = parse_bool(raw)
            else:
                sp_init[name] = cast_value(ftype, raw)
            if sp_init[name] is None:
                sp_init[name] = default
        sp_init["is_spouse"] = True
        spouse = taxclaude.PersonalTaxData(**sp_init)

    # Parse children information
    num_children = int(num_children_raw) if num_children_raw else 0
    ages_list = parse_list_of_ints(children_ages_raw)
    disability_indices = parse_list_of_ints(children_disability_raw)

    # Family attributes
    resp_contrib = 0.0
    try:
        resp_contrib = float(resp_contributions_raw)
    except Exception:
        resp_contrib = 0.0
    caregiver_amt = 0.0
    try:
        caregiver_amt = float(caregiver_amount_raw)
    except Exception:
        caregiver_amt = 0.0

    family = taxclaude.FamilyTaxData(
        taxpayer=taxpayer,
        spouse=spouse,
        has_spouse=spouse_exists,
        num_children=num_children,
        children_ages=ages_list,
        children_with_disability=disability_indices,
        resp_contributions=resp_contrib,
        eligible_dependant=parse_bool(eligible_dependant_raw),
        canada_caregiver_amount=caregiver_amt,
    )

    calc = taxclaude.TaxCalculator(family)
    family_results = calc.calculate_family()
    contribution_optimization = None
    credit_optimization = None
    refund_optimization = None

    input_url = build_input_url(params)

    return templates.TemplateResponse(
        "results.html",
        {
            "request": request,
            "results": family_results,
            "contribution_optimization": contribution_optimization,
            "credit_optimization": credit_optimization,
            "refund_optimization": refund_optimization,
            "input_url": input_url,
            "retry_url": "/retry",
            "saved_at": saved_at,
        },
    )


@app.get("/calculate", response_class=HTMLResponse)
async def calculate(request: Request) -> HTMLResponse:
    """Process the submitted form via query parameters, compute results and render them."""
    params = dict(request.query_params)
    saved = load_last_submission()
    if saved and isinstance(saved.get("params"), dict):
        merged = dict(saved["params"])
        merged.update(params)
        params = merged
    saved_at = save_last_submission(params)
    return calculate_from_params(request, params, saved_at=saved_at)


@app.get("/retry", response_class=HTMLResponse)
async def retry(request: Request) -> HTMLResponse:
    saved = load_last_submission()
    if not saved:
        return HTMLResponse("<h1>No saved submission found.</h1><p><a href=\"/\">Back to form</a></p>", status_code=404)
    params = saved.get("params", {})
    saved_at = saved.get("saved_at")
    return calculate_from_params(request, params, saved_at=saved_at)


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="0.0.0.0", port=8000)
