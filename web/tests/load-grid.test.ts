import assert from "node:assert/strict";
import { test } from "node:test";

import { LOAD_PLACE, noticeText } from "../src/lib/load-grid.ts";

test("noticeText adds the FTP notice's next step, once, after a full stop", () => {
  assert.equal(
    noticeText("ftp_mismatch", "FTP er sat til 230 W, men dine ture peger på 183 W"),
    "FTP er sat til 230 W, men dine ture peger på 183 W. Cykel-TSS regnes ud fra FTP, så ret den i intervals.icu.",
  );
  assert.equal(
    noticeText("ftp_mismatch", "Allerede et punktum."),
    "Allerede et punktum. Cykel-TSS regnes ud fra FTP, så ret den i intervals.icu.",
  );
  assert.equal(noticeText("another_kind", "Som skrevet"), "Som skrevet"); // unknown kinds as written
});

test("the /load grid keeps the phone order: hero and week in the rail, the chart in main", () => {
  assert.match(LOAD_PLACE.hero, /lg:col-start-1/);
  assert.match(LOAD_PLACE.week, /lg:col-start-1 .*lg:row-start-2|lg:row-start-2/);
  assert.match(LOAD_PLACE.chart, /lg:col-start-5/);
});
