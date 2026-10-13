import assert from "node:assert/strict";
import { test } from "node:test";

import { noticeText } from "../src/lib/notices.ts";

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
