"""
Læser Benjamins program-tab (Powerlifting Now-template) fra xlsx-eksport
og producerer en sæt-tabel med rå score pr. sæt (formlen er uændret fra strength_collector.py).

Brug:  parse_all(xlsx_bytes, bodyweight, issues)   (læser alle "Program - blok *"-tabs)
Celler der ikke kan læses bliver aldrig stille til 0: de tælles i ``issues`` (årsag -> antal),
og manglende/ulæselig kg gemmes som None. Selve score-formlen er uændret.
STRENGTH_K (tidl. K) ganges på i domain.strength; BODYWEIGHT kommer fra env via parameteren.
"""
import io, re, datetime as dt
from collections import Counter
from typing import TypedDict
import openpyxl

class ParsedSet(TypedDict):
    date: dt.date
    block: str
    row: int              # 1-baseret række i fanen
    week: int             # 1-baseret uge i fanen
    section: int          # 1-baseret dag-sektion (dato-række) i fanen; kun rækkefølge, aldrig ugedag
    type: str
    name: str
    set: int
    reps: float
    logged_kg: float | None  # kg som logget, før kropsvægt; None = tom, ulæselig, eller 0 på en vægtøvelse (fx -10%-formlen før topsættet er logget). 0 er en rigtig værdi KUN på kropsvægtøvelser (kun kropsvægt)
    kg: float             # kg brugt i scoren (logged_kg + bodyweight for kropsvægtøvelser)
    bodyweight: bool
    rpe: float | None
    prescribed: str | None  # foreskrevet load-celle som tekst (fx 'RPE 7 - 8'), kun til visning
    sets_text: str | None   # sets-cellen som skrevet (fx '2'), kun til visning
    reps_text: str | None   # reps-cellen som skrevet (fx '8 - 12'), kun til visning
    e1rm: float | None      # fanens 1RM for sættets løft (SQUAT/BENCH/DEADLIFT), ellers None
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

# Decimal comma only with 1-2 decimals: "110,115" is the template's list of weights, not 110.115.
_NUMBER_TEXT = re.compile(r"^\s*-?\d+(?:\.\d+|,\d{1,2})?\s*$")

def text_number(cell: object) -> object:
    """Et tal skrevet som tekst ('137.5', '137,5', '140') -> float; alt andet uændret.
    Arket kan have KG-kolonnen formateret som tekst, så indtastet kg kommer som str."""
    if isinstance(cell, str) and _NUMBER_TEXT.match(cell):
        return float(cell.strip().replace(",", "."))
    return cell

def cell_text(cell: object) -> str | None:
    """En celle som i arket: tekst uændret, tal uden overflødige decimaler (3.0 -> '3')."""
    if cell is None or cell == "": return None
    if isinstance(cell, (int, float)) and not isinstance(cell, bool): return f"{cell:g}"
    return str(cell).strip() or None

def prescribed_text(load: object) -> str | None:
    """Load-cellen som i arket: tekst uændret, procent-tal (-0.1) som '-10%', andre tal som tekst."""
    if load is None or load == "": return None
    if isinstance(load, (int, float)) and not isinstance(load, bool):
        return f"{load*100:g}%" if abs(load) < 1 else f"{load:g}"
    return str(load).strip()

# Årsager i issues (nøglerne logges som de er; aldrig celleværdier).
KG_NOT_A_NUMBER = "kg not a number"
SETS_REPS_NOT_A_NUMBER = "sets/reps not a number"
WEEK_DATE_NOT_A_DATE = "week date not a date"
ROW_WITHOUT_TYPE = "prescribed row without type"

E1RM_RANGE = (20.0, 400.0)   # kg; et 1RM udenfor er aldrig et rigtigt 1RM
E1RM_OUT_OF_RANGE = "1RM out of range"

def set_score(typ, name, reps, kg, load, bodyweight, e1rm):
    """Score for ét sæt: formlen fra strength_collector.py, uændret (flyttet hertil så prognosen
    kan genbruge den). kg = logget kg (0 hvis tom). Returnerer (kg brugt, rpe, score, kropsvægt?)."""
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
    return kg, rpe, score, bw

def read_e1rm(rows, issues: Counter[str]) -> dict[str, float]:
    """1RM pr. løft fra fanens top (de første 15 rækker): løftets navn med tallet 5 kolonner til højre.
    Kun FØRSTE match tæller: skabelonen har længere nede en BLOCK SBD METRICS-tabel med de samme
    navne og tonnage i samme kolonne. Et tal udenfor E1RM_RANGE tælles i issues og bruges ikke."""
    e1rm = {}
    for r in rows[:15]:
        for i,c in enumerate(r):
            if c in ("SQUAT","BENCH","DEADLIFT") and c not in e1rm and i+5 < len(r) and isinstance(r[i+5],(int,float)):
                e1rm[c] = float(r[i+5])
    for lift, kg in list(e1rm.items()):
        if not E1RM_RANGE[0] <= kg <= E1RM_RANGE[1]:
            issues[E1RM_OUT_OF_RANGE] += 1
            del e1rm[lift]
    return e1rm

def parse_all(data: bytes, bodyweight: float, issues: Counter[str] | None = None,
              counts_issues=None) -> list[ParsedSet]:
    """``counts_issues(tab)`` False: the tab is parsed but its unreadable cells aren't counted
    (the caller drops it anyway, e.g. a template tab without a block number)."""
    wb = openpyxl.load_workbook(io.BytesIO(data), data_only=True)
    sets = []
    for tab in wb.sheetnames:
        if tab.startswith("Program - blok"):
            counted = counts_issues is None or counts_issues(tab)
            sets += parse_tab(wb[tab], tab, bodyweight, issues if counted else Counter())
    return sets

def parse_tab(ws, tab, bodyweight, issues: Counter[str] | None = None):
    issues = Counter() if issues is None else issues
    rows = list(ws.iter_rows(values_only=True))
    e1rm = read_e1rm(rows, issues)
    sets = []
    week_dates = None
    section = 0
    for ri, r in enumerate(rows, start=1):
        if r and isinstance(r[1],dt.datetime) and "WEEK 1" in [str(x) for x in r]:
            # dato-række: dato står 2 kolonner efter 'WEEK n'
            week_dates = [r[i+2] for i,c in enumerate(r) if isinstance(c,str) and c.startswith("WEEK")]
            section += 1
            continue
        if not week_dates or not r or not r[2]: continue
        typ, name = str(r[1] or "").strip(), str(r[2]).strip()
        if typ in ("TYPE","Micro Length","DAY","LIFT","MUSCLE GROUP") or typ.startswith("MICRO") or name=="NAME": continue
        if not typ and name.lower().startswith("abs"): typ = "ABS"
        if not typ:
            if any(4+w*8 < len(r) and r[4+w*8] not in (None,0,"") for w in range(len(week_dates))):
                issues[ROW_WITHOUT_TYPE] += 1   # foreskrevet, men uden TYPE: ville ellers forsvinde stille
            continue
        for w,date in enumerate(week_dates):
            base = 4 + w*8          # SETS-kolonne for uge w
            nsets, reps, load, kg = r[base], r[base+1], r[base+2], r[base+3]
            kg = text_number(kg)
            sets_text, reps_text = cell_text(nsets), cell_text(reps)
            if nsets in (None,0,"") or reps in (None,"") : continue
            if mid(nsets) is None or mid(reps) is None:
                issues[SETS_REPS_NOT_A_NUMBER] += 1; continue
            if not isinstance(date, dt.datetime):
                issues[WEEK_DATE_NOT_A_DATE] += 1; continue
            kg_ok = isinstance(kg,(int,float)) and not isinstance(kg,bool)
            if not kg_ok and kg not in (None,""): issues[KG_NOT_A_NUMBER] += 1
            nsets, reps = int(mid(nsets)), mid(reps)
            kg = float(kg) if isinstance(kg,(int,float)) else 0.0
            logged = kg
            kg, rpe, score, bw = set_score(typ, name, reps, kg, load, bodyweight, e1rm)
            for s in range(nsets):
                sets.append(ParsedSet(date=date.date(), block=tab, row=ri, week=w+1, section=section, type=typ, name=name, set=s+1,
                                      reps=reps, logged_kg=logged if kg_ok and (logged or bw) else None, kg=kg, bodyweight=bw, rpe=rpe, score=round(score,1),
                                      prescribed=prescribed_text(load),
                                      sets_text=sets_text, reps_text=reps_text,
                                      e1rm=e1rm.get(typ)))
    return sets
