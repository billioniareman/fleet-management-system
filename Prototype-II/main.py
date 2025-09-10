from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
import os, json

app = FastAPI()

# Allow frontend to fetch
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
CASES_DIR = os.path.join(BASE_DIR, "cases")  # matches your structure

@app.get("/")
def read_root():
    return FileResponse("working_route_viewer.html")

@app.get("/cases")
def list_cases():
    # return folder names inside /cases (1 to 13)
    return {"cases": sorted(os.listdir(CASES_DIR))}

@app.get("/cases/{case_id}")
def get_case(case_id: str):
    # look for "get.json" in that folder
    case_path = os.path.join(CASES_DIR, case_id, "get.json")
    if not os.path.exists(case_path):
        raise HTTPException(status_code=404, detail=f"get.json not found for case {case_id}")
    with open(case_path, "r") as f:
        data = json.load(f)
    return data

@app.get("/cases/{case_id}/get.json")
def get_case_json(case_id: str):
    # Direct access to get.json files
    case_path = os.path.join(CASES_DIR, case_id, "get.json")
    if not os.path.exists(case_path):
        raise HTTPException(status_code=404, detail=f"get.json not found for case {case_id}")
    return FileResponse(case_path)
