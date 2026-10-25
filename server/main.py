"""Shot Coach server: receives a small camera frame, asks Gemini where the faces are,
and returns boxes plus eyes-closed and smiling flags. Nothing is stored."""
import hmac
import json
import os
import time

from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

MODEL = os.getenv("GEMINI_MODEL", "gemini-2.5-flash")
API_KEY = os.getenv("API_KEY", "")  # shared access code the app sends in X-Api-Key
ORIGINS = [o.strip() for o in os.getenv("ALLOWED_ORIGINS", "https://prdurgam-edu.github.io").split(",") if o.strip()]
MAX_BYTES = 800_000

PROMPT = """You are the vision module of a photo coaching camera. Look at the image.
List every human face that is clearly visible, including small faces in the background.
For each face give:
- ymin, xmin, ymax, xmax: the box around the whole face (forehead to chin), integers from 0 to 1000 relative to the image height and width
- eyes_closed: true only if the eyes are clearly shut (not a squint, not looking down)
- smiling: true if the person is smiling
{people_rule}
Do not invent people. If nobody is visible, return empty lists."""

PEOPLE_RULE = """Also list each person whose body is visible in "people", with feet_visible true only if their feet or shoes
are fully inside the image and not cut off by the bottom edge or hidden."""
NO_PEOPLE_RULE = 'Leave "people" as an empty list.'


class Face(BaseModel):
    ymin: int
    xmin: int
    ymax: int
    xmax: int
    eyes_closed: bool
    smiling: bool


class Person(BaseModel):
    feet_visible: bool


class Analysis(BaseModel):
    faces: list[Face]
    people: list[Person]


_client = None


def client():
    global _client
    if _client is None:
        from google import genai

        key = os.getenv("GEMINI_API_KEY")
        if key:
            _client = genai.Client(api_key=key)
        else:
            _client = genai.Client(
                vertexai=True,
                project=os.getenv("GOOGLE_CLOUD_PROJECT"),
                location=os.getenv("VERTEX_LOCATION", "global"),
            )
    return _client


def run_model(jpeg: bytes, want_people: bool) -> dict:
    """Ask Gemini about one frame. Returns {'faces': [...], 'people': [...]} using the Analysis fields."""
    from google.genai import types

    prompt = PROMPT.format(people_rule=PEOPLE_RULE if want_people else NO_PEOPLE_RULE)
    parts = [types.Part.from_bytes(data=jpeg, mime_type="image/jpeg"), prompt]

    def call(thinking: bool):
        cfg = dict(
            response_mime_type="application/json",
            response_schema=Analysis,
            temperature=0,
            max_output_tokens=1500,
        )
        if thinking:
            cfg["thinking_config"] = types.ThinkingConfig(thinking_budget=0)  # fastest answer
        return client().models.generate_content(model=MODEL, contents=parts, config=types.GenerateContentConfig(**cfg))

    try:
        resp = call(True)
    except Exception as e:  # some models reject a zero thinking budget
        if "thinking" not in str(e).lower():
            raise
        resp = call(False)
    parsed = getattr(resp, "parsed", None)
    if isinstance(parsed, Analysis):
        return parsed.model_dump()
    return Analysis(**json.loads(resp.text)).model_dump()


def to_unit(v: int) -> float:
    return max(0.0, min(1.0, v / 1000.0))


def shape(result: dict, want_people: bool) -> dict:
    faces = []
    for f in result.get("faces", []):
        x0, x1 = sorted((to_unit(f["xmin"]), to_unit(f["xmax"])))
        y0, y1 = sorted((to_unit(f["ymin"]), to_unit(f["ymax"])))
        if x1 - x0 < 0.005 or y1 - y0 < 0.005:
            continue
        faces.append({"minX": x0, "maxX": x1, "minY": y0, "maxY": y1,
                      "eyesClosed": bool(f["eyes_closed"]), "smiling": bool(f["smiling"])})
    people = [{"feetVisible": bool(p["feet_visible"])} for p in result.get("people", [])] if want_people else []
    return {"faces": faces, "people": people}


app = FastAPI(title="Shot Coach server")
app.add_middleware(
    CORSMiddleware,
    allow_origins=ORIGINS,
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["content-type", "x-api-key", "x-framing"],
    max_age=3600,
)


def require_key(request: Request):
    if API_KEY and not hmac.compare_digest(request.headers.get("x-api-key", ""), API_KEY):
        raise HTTPException(status_code=401, detail="Wrong access code")


@app.get("/health")
def health():
    return {"ok": True, "model": MODEL}


@app.get("/check")
def check(request: Request):
    """Lets the app confirm the address and access code without spending a model call."""
    require_key(request)
    return {"ok": True}


@app.post("/analyze")
async def analyze(request: Request):
    require_key(request)
    body = await request.body()
    if not body:
        raise HTTPException(status_code=400, detail="No image")
    if len(body) > MAX_BYTES:
        raise HTTPException(status_code=413, detail="Image too large")
    if not body.startswith(b"\xff\xd8"):
        raise HTTPException(status_code=415, detail="Send a JPEG")
    want_people = request.headers.get("x-framing", "upper") == "full"
    t0 = time.time()
    try:
        result = run_model(body, want_people)
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Model error: {type(e).__name__}") from e
    out = shape(result, want_people)
    out["ms"] = int((time.time() - t0) * 1000)
    return out
