"""
Læser Benjamins program-tab (Powerlifting Now-template) fra xlsx-eksport
og producerer en sæt-tabel med rå score pr. sæt (formlen er uændret fra strength_collector.py).

Brug:  parse_all(xlsx_bytes, bodyweight)   (læser alle "Program - blok *"-tabs)
STRENGTH_K (tidl. K) ganges på i domain.strength; BODYWEIGHT kommer fra env via parameteren.
"""
import io, re, datetime as dt
from typing import TypedDict
import openpyxl

class ParsedSet(TypedDict):
    date: dt.date
    block: str
    row: int              # 1-baseret række i fanen
    week: int             # 1-baseret uge i fanen
    type: str
    name: str
    set: int
    reps: float
    logged_kg: float      # kg som logget (0 hvis tom), før kropsvægt lægges til
    kg: float             # kg brugt i scoren (logged_kg + bodyweight for kropsvægtøvelser)
    bodyweight: bool
    rpe: float | None
    prescribed: str | None  # foreskrevet load-celle som tekst (fx 'RPE 7 - 8'), kun til visning
    score: float          # rå score, før STRENGTH_K

ABS_SET_SCORE = 10*20*(0.6**2)   # fast score pr. abs-sæt (10 reps @ 20 kg RPE 6)
LEG_TYPES = ("SQUAT","DEADLIFT","QUADS","HAMSTRINGS","GLUTES","ADDUCTORS","CALVES","LOWER BACK")
BODYWEIGHT_EX = ("dips","chin","pull-up","pullup","push-up")

# RPE-ækvivalent fra %E1RM og reps (Tuchscherer, forenklet)
# e1rm% ≈ 1 / (1 + 0.0333*(reps + (10-rpe)))   -> løst for rpe
def rpe_from_pct(pct, reps):
    if not pct or pct <= 0: return None
    rir = (1/pct - 1)/0.0333 - reps
    return max(4.0, min(10.0, 10 - rir))

def mid(txt):
    """'8 - 12' -> 10, 'RPE 6 - 7' -> 6.5, 'RPE 7 - 5' (typo) -> 6, 5 -> 5"""
    if txt is None: return None
    if isinstance(txt,(int,float)): return float(txt)
    nums = [float(x) for x in re.findall(r"\d+(?:\.\d+)?", str(txt))]
    return sum(nums)/len(nums) if nums else None

def prescribed_text(load: object) -> str | None:
    """Load-cellen som i arket: tekst uændret, procent-tal (-0.1) som '-10%', andre tal som tekst."""
    if load is None or load == "": return None
    if isinstance(load, (int, float)) and not isinstance(load, bool):
        return f"{load*100:g}%" if abs(load) < 1 else f"{load:g}"
    return str(load).strip()

def parse_all(data: bytes, bodyweight: float) -> list[ParsedSet]:
    wb = openpyxl.load_workbook(io.BytesIO(data), data_only=True)
    sets = []
    for tab in wb.sheetnames:
        if tab.startswith("Program - blok"): sets += parse_tab(wb[tab], tab, bodyweight)
    return sets

def parse_tab(ws, tab, bodyweight):
    rows = list(ws.iter_rows(values_only=True))
    e1rm = {}
    for r in rows[:15]:
        for i,c in enumerate(r):
            if c in ("SQUAT","BENCH","DEADLIFT") and i+5 < len(r) and isinstance(r[i+5],(int,float)):
                e1rm[c] = float(r[i+5])
    sets = []
    week_dates = None
    for ri, r in enumerate(rows, start=1):
        if r and isinstance(r[1],dt.datetime) and "WEEK 1" in [str(x) for x in r]:
            # dato-række: dato står 2 kolonner efter 'WEEK n'
            week_dates = [r[i+2] for i,c in enumerate(r) if isinstance(c,str) and c.startswith("WEEK")]
            continue
        if not week_dates or not r or not r[2]: continue
        typ, name = str(r[1] or "").strip(), str(r[2]).strip()
        if typ in ("TYPE","Micro Length","DAY","LIFT","MUSCLE GROUP") or typ.startswith("MICRO") or name=="NAME": continue
        if not typ and name.lower().startswith("abs"): typ = "ABS"
        if not typ: continue
        for w,date in enumerate(week_dates):
            base = 4 + w*8          # SETS-kolonne for uge w
            nsets, reps, load, kg = r[base], r[base+1], r[base+2], r[base+3]
            if nsets in (None,0,"") or reps in (None,"") : continue
            nsets, reps = int(mid(nsets)), mid(reps)
            kg = float(kg) if isinstance(kg,(int,float)) else 0.0
            logged = kg
            bw = any(b in name.lower() for b in BODYWEIGHT_EX)
            if typ == "ABS":
                score = ABS_SET_SCORE; rpe=None
            else:
                if bw: kg += bodyweight
                main = typ in e1rm and "tempo" not in name.lower()   # tempo ≈ 20-25% lettere, brug foreskrevet RPE
                rpe = rpe_from_pct(kg/e1rm[typ], reps) if (main and kg) else None
                if rpe is None: rpe = mid(load) if isinstance(load,str) and "RPE" in str(load) else None
                if rpe is None: rpe = 6.0     # ukendt (fx -10% uden kg endnu)
                factor = 1.0 if typ.startswith(LEG_TYPES) else 0.6
                score = reps * kg * (rpe/10)**2 * factor
            for s in range(nsets):
                sets.append(ParsedSet(date=date.date(), block=tab, row=ri, week=w+1, type=typ, name=name, set=s+1,
                                      reps=reps, logged_kg=logged, kg=kg, bodyweight=bw, rpe=rpe, score=round(score,1),
                                      prescribed=prescribed_text(load)))
    return sets
