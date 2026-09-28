"""
Læser Benjamins program-tab (Powerlifting Now-template) fra xlsx-eksport
og producerer en sæt-tabel + styrke-TSS pr. session.

Brug:  python strength_collector.py sheet.xlsx   (læser alle "Program - blok *"-tabs)
Output: sets.csv (én række pr. sæt), sessions.csv (TSS pr. dato)
"""
import sys, re, csv, datetime as dt
import openpyxl

K = 0.02              # kalibreringsfaktor – justeres mod cykel-TSS
BODYWEIGHT = 0        # kg, bruges til dips/kropsvægtøvelser (sæt din vægt)
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

def parse_all(path):
    wb = openpyxl.load_workbook(path, data_only=True)
    sets = []
    for tab in wb.sheetnames:
        if tab.startswith("Program - blok"): sets += parse_tab(wb[tab], tab)
    return sets

def parse_tab(ws, tab):
    rows = list(ws.iter_rows(values_only=True))
    e1rm = {}
    for r in rows[:15]:
        for i,c in enumerate(r):
            if c in ("SQUAT","BENCH","DEADLIFT") and i+5 < len(r) and isinstance(r[i+5],(int,float)):
                e1rm[c] = float(r[i+5])
    sets = []
    week_dates = None
    for r in rows:
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
            if typ == "ABS":
                score = ABS_SET_SCORE; rpe=None
            else:
                if any(b in name.lower() for b in BODYWEIGHT_EX): kg += BODYWEIGHT
                main = typ in e1rm and "tempo" not in name.lower()   # tempo ≈ 20-25% lettere, brug foreskrevet RPE
                rpe = rpe_from_pct(kg/e1rm[typ], reps) if (main and kg) else None
                if rpe is None: rpe = mid(load) if isinstance(load,str) and "RPE" in str(load) else None
                if rpe is None: rpe = 6.0     # ukendt (fx -10% uden kg endnu)
                factor = 1.0 if typ.startswith(LEG_TYPES) else 0.6
                score = reps * kg * (rpe/10)**2 * factor
            for s in range(nsets):
                sets.append(dict(date=date.date(), block=tab, type=typ, name=name, set=s+1,
                                 reps=reps, kg=kg, rpe=rpe, score=round(score,1)))
    return sets

if __name__ == "__main__":
    sets = parse_all(sys.argv[1])
    with open("sets.csv","w",newline="") as f:
        w = csv.DictWriter(f, fieldnames=sets[0].keys()); w.writeheader(); w.writerows(sets)
    sess = {}
    for s in sets: sess[s["date"]] = sess.get(s["date"],0)+s["score"]
    with open("sessions.csv","w",newline="") as f:
        w = csv.writer(f); w.writerow(["date","strength_tss"])
        for d in sorted(sess): w.writerow([d, round(sess[d]*K,1)])
    for d in sorted(sess): print(d, round(sess[d]*K,1))
