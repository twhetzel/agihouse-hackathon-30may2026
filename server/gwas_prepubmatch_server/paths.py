from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
SKILLS_VENDOR = REPO_ROOT / ".agent" / "skills" / "_vendor" / "science-skills" / "skills"

OPENALEX_SKILL = SKILLS_VENDOR / "literature_search_openalex"
EUROPEPMC_SKILL = SKILLS_VENDOR / "literature_search_europepmc"
PUBMED_SKILL = SKILLS_VENDOR / "pubmed_database"
BIORXIV_SKILL = SKILLS_VENDOR / "literature_search_biorxiv"


def skills_installed() -> bool:
    return (
        (OPENALEX_SKILL / "scripts" / "openalex_cli.py").is_file()
        and (EUROPEPMC_SKILL / "scripts" / "europepmc_api.py").is_file()
        and (PUBMED_SKILL / "scripts" / "pubmed_api.py").is_file()
    )
