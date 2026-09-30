"""config: typed, fail-fast, per-CLI requirements."""

import json
import os
from pathlib import Path

import pytest

from training_load.cli import check_config
from training_load.config import (
    ConfigError,
    all_problems,
    collect_intervals_config,
    collect_strength_config,
    compute_config,
    load_dotenv_file,
    mask_in_ci,
)

SERVICE_ACCOUNT = json.dumps(
    {
        "type": "service_account",
        "client_email": "sa@p.iam.gserviceaccount.com",
        "private_key": "-----BEGIN",
    }
)
SHEET_ID = "1AbC_dEf-123456789xyz"
SUPABASE = {"SUPABASE_URL": "https://ref.supabase.co/", "SUPABASE_SERVICE_KEY": "sb_secret_k"}


def test_each_cli_requires_only_its_vars() -> None:
    intervals = collect_intervals_config(
        {**SUPABASE, "INTERVALS_API_KEY": "k", "INTERVALS_ATHLETE_ID": "i1"}
    )
    assert intervals.supabase.url == "https://ref.supabase.co"
    strength = collect_strength_config(
        {
            **SUPABASE,
            "GOOGLE_SHEET_ID": SHEET_ID,
            "GOOGLE_SERVICE_ACCOUNT_JSON": SERVICE_ACCOUNT,
            "BODYWEIGHT": "82.5",
        }
    )
    assert strength.bodyweight == 82.5
    assert strength.google.service_account_info["client_email"] == "sa@p.iam.gserviceaccount.com"
    assert compute_config({**SUPABASE, "STRENGTH_K": "0.02"}).strength_k == 0.02


def test_all_missing_vars_reported_in_one_error() -> None:
    with pytest.raises(ConfigError) as exc:
        collect_intervals_config({})
    for name in (
        "INTERVALS_API_KEY",
        "INTERVALS_ATHLETE_ID",
        "SUPABASE_URL",
        "SUPABASE_SERVICE_KEY",
    ):
        assert name in str(exc.value)


@pytest.mark.parametrize("value", ["abc", "0", "-1", "nan", "inf", "300"])
def test_bodyweight_must_be_a_sane_number(value: str) -> None:
    env = {
        **SUPABASE,
        "GOOGLE_SHEET_ID": SHEET_ID,
        "GOOGLE_SERVICE_ACCOUNT_JSON": SERVICE_ACCOUNT,
        "BODYWEIGHT": value,
    }
    with pytest.raises(ConfigError, match="BODYWEIGHT"):
        collect_strength_config(env)


@pytest.mark.parametrize(
    "value",
    [
        SHEET_ID,
        f"https://docs.google.com/spreadsheets/d/{SHEET_ID}/edit?gid=0#gid=0",
        f"https://drive.google.com/file/d/{SHEET_ID}/view",
    ],
)
def test_sheet_id_accepts_bare_id_or_url(value: str) -> None:
    env = {
        **SUPABASE,
        "GOOGLE_SHEET_ID": value,
        "GOOGLE_SERVICE_ACCOUNT_JSON": SERVICE_ACCOUNT,
        "BODYWEIGHT": "80",
    }
    assert collect_strength_config(env).google.sheet_id == SHEET_ID


@pytest.mark.parametrize("value", ["https://docs.google.com/spreadsheets/u/0/", "id with spaces"])
def test_sheet_id_rejects_garbage(value: str) -> None:
    env = {
        **SUPABASE,
        "GOOGLE_SHEET_ID": value,
        "GOOGLE_SERVICE_ACCOUNT_JSON": SERVICE_ACCOUNT,
        "BODYWEIGHT": "80",
    }
    with pytest.raises(ConfigError, match="GOOGLE_SHEET_ID"):
        collect_strength_config(env)


@pytest.mark.parametrize("value", ["0", "-0.1", "x"])
def test_strength_k_must_be_positive(value: str) -> None:
    with pytest.raises(ConfigError, match="STRENGTH_K"):
        compute_config({**SUPABASE, "STRENGTH_K": value})


@pytest.mark.parametrize(
    "value",
    ["not json", json.dumps({"type": "authorized_user"}), json.dumps({"type": "service_account"})],
)
def test_service_account_json_must_be_a_service_account_key(value: str) -> None:
    env = {
        **SUPABASE,
        "GOOGLE_SHEET_ID": SHEET_ID,
        "GOOGLE_SERVICE_ACCOUNT_JSON": value,
        "BODYWEIGHT": "80",
    }
    with pytest.raises(ConfigError, match="GOOGLE_SERVICE_ACCOUNT_JSON"):
        collect_strength_config(env)


def test_errors_and_repr_never_contain_secret_values() -> None:
    config = collect_intervals_config(
        {**SUPABASE, "INTERVALS_API_KEY": "top-secret", "INTERVALS_ATHLETE_ID": "i1"}
    )
    assert "top-secret" not in repr(config) and "sb_secret_k" not in repr(config)
    with pytest.raises(ConfigError) as exc:
        compute_config({**SUPABASE, "SUPABASE_URL": "http://leaky", "STRENGTH_K": "x"})
    assert "leaky" not in str(exc.value)


def test_dotenv_local_is_loaded_without_overriding_real_env(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    (tmp_path / ".env.local").write_text("STRENGTH_K=0.5\nBODYWEIGHT=99\n", encoding="utf-8")
    nested = tmp_path / "python"
    nested.mkdir()
    monkeypatch.chdir(nested)
    monkeypatch.setenv("STRENGTH_K", "0.02")
    monkeypatch.setenv("BODYWEIGHT", "placeholder")  # records the original state for teardown
    monkeypatch.delenv("BODYWEIGHT")
    load_dotenv_file()
    assert os.environ["STRENGTH_K"] == "0.02"
    assert os.environ["BODYWEIGHT"] == "99"


def test_no_dotenv_file_is_not_an_error(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.chdir(tmp_path)
    load_dotenv_file()


def test_mask_in_ci_only_prints_inside_github_actions(
    monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    monkeypatch.delenv("GITHUB_ACTIONS", raising=False)
    mask_in_ci(SHEET_ID)
    assert capsys.readouterr().out == ""
    monkeypatch.setenv("GITHUB_ACTIONS", "true")
    mask_in_ci(SHEET_ID, "")
    assert capsys.readouterr().out == f"::add-mask::{SHEET_ID}\n"


def test_all_problems_lists_every_job_at_once_without_values() -> None:
    env = {
        "INTERVALS_API_KEY": "k-secret",
        "GOOGLE_SERVICE_ACCOUNT_JSON": '\'{"type": "service_account"}\'',
        "SUPABASE_URL": "https://x.supabase.co",
        "SUPABASE_SERVICE_KEY": "sb_secret_x",
        "BODYWEIGHT": "82.5",
        "STRENGTH_K": "0,10",
    }
    problems = all_problems(env)
    assert problems == [
        "INTERVALS_ATHLETE_ID is missing",
        "GOOGLE_SHEET_ID is missing",
        "GOOGLE_SERVICE_ACCOUNT_JSON is not valid JSON "
        "(remove the quotes around it: they belong in .env.local only)",
        "STRENGTH_K must be a number (use a decimal point, not a comma)",
    ]
    assert not any("k-secret" in p or "sb_secret_x" in p for p in problems)


def test_check_config_exit_codes(
    monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture
) -> None:
    monkeypatch.setattr(check_config, "load_dotenv_file", lambda: None)
    for name in (
        "INTERVALS_API_KEY",
        "INTERVALS_ATHLETE_ID",
        "GOOGLE_SHEET_ID",
        "GOOGLE_SERVICE_ACCOUNT_JSON",
        "SUPABASE_URL",
        "SUPABASE_SERVICE_KEY",
        "BODYWEIGHT",
        "STRENGTH_K",
    ):
        monkeypatch.delenv(name, raising=False)
    assert check_config.main([]) == 2
    assert "8 configuration problems" in caplog.text
