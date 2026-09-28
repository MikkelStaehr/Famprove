"""Download the coach's workbook as xlsx bytes via the Drive API (read-only).

Read-only is enforced by the OAuth scope: the token can read, never write. The service
account is shared on the file as Viewer.
"""

from collections.abc import Mapping
from typing import Final
from urllib.parse import quote

import google.auth.transport.requests
from google.oauth2 import service_account

from training_load.http import HttpSend, request

ZIP_MAGIC: Final = b"PK\x03\x04"
"""xlsx is a zip archive."""

DRIVE_SCOPE: Final = "https://www.googleapis.com/auth/drive.readonly"
DRIVE_FILES_URL: Final = "https://www.googleapis.com/drive/v3/files"
GOOGLE_SHEET_MIME: Final = "application/vnd.google-apps.spreadsheet"
XLSX_MIME: Final = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"


def access_token(service_account_info: Mapping[str, str]) -> str:
    """Mint a bearer token for DRIVE_SCOPE from the service-account key (google-auth).

    ``service_account.Credentials.from_service_account_info(info, scopes=[DRIVE_SCOPE])``,
    then ``refresh(google.auth.transport.requests.Request())``.
    """
    credentials = service_account.Credentials.from_service_account_info(  # type: ignore[no-untyped-call]
        dict(service_account_info), scopes=[DRIVE_SCOPE]
    )
    credentials.refresh(google.auth.transport.requests.Request())
    token = credentials.token
    if not isinstance(token, str) or not token:
        raise RuntimeError("Google did not return an access token for the service account")
    return token


def download_workbook(send: HttpSend, *, token: str, file_id: str) -> bytes:
    """Return the workbook as xlsx bytes.

    1. GET {DRIVE_FILES_URL}/{file_id}?fields=mimeType&supportsAllDrives=true
    2. mimeType == GOOGLE_SHEET_MIME  -> GET .../{file_id}/export?mimeType=XLSX_MIME
       otherwise (an uploaded .xlsx)  -> GET .../{file_id}?alt=media&supportsAllDrives=true
    Deciding from metadata keeps the fallback deterministic instead of error-driven.
    Raises if the result is empty or not a zip (xlsx) payload.
    """
    headers = {"Authorization": f"Bearer {token}"}
    file_url = f"{DRIVE_FILES_URL}/{quote(file_id, safe='')}"
    meta = request(
        send,
        "GET",
        file_url,
        headers=headers,
        params=[("fields", "mimeType"), ("supportsAllDrives", "true")],
    ).json()
    mime = meta.get("mimeType") if isinstance(meta, dict) else None
    if mime == GOOGLE_SHEET_MIME:
        response = request(
            send, "GET", f"{file_url}/export", headers=headers, params=[("mimeType", XLSX_MIME)]
        )
    elif mime == XLSX_MIME:
        response = request(
            send,
            "GET",
            file_url,
            headers=headers,
            params=[("alt", "media"), ("supportsAllDrives", "true")],
        )
    else:
        raise ValueError(f"GOOGLE_SHEET_ID is not a Google Sheet or .xlsx file (mimeType {mime!r})")
    data = response.content
    if not data.startswith(ZIP_MAGIC):
        raise ValueError("Drive returned an empty or non-xlsx payload")
    return data
