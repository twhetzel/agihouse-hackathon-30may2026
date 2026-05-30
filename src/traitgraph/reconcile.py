import re

STOPWORDS = {
    "of", "in", "and", "the", "analysis", "study", "genome-wide",
    "association", "gwas", "a", "for", "to", "with", "by", "on",
    "at", "from", "cohort", "cohorts", "populations", "analysis"
}

def clean_tokens(text):
    """Tokenize string, lowercase, and remove punctuation and stopwords."""
    if not text:
        return set()
    # Replace non-alphanumeric with spaces, then split
    words = re.findall(r"\b\w+\b", text.lower())
    return {w for w in words if w not in STOPWORDS}

def normalize_author(name):
    """Normalize author names to standard lowercase alphanumeric (e.g. 'Smith J.' -> 'smithj')."""
    if not name:
        return ""
    # Strip spaces, periods, and lowercase
    return re.sub(r"[^a-zA-Z0-9]", "", name).lower()

def compute_title_similarity(title1, title2):
    """Compute Jaccard similarity of cleaned title token sets."""
    tokens1 = clean_tokens(title1)
    tokens2 = clean_tokens(title2)
    
    if not tokens1 or not tokens2:
        return 0.0
    
    intersection = tokens1.intersection(tokens2)
    union = tokens1.union(tokens2)
    return len(intersection) / len(union)

def compute_author_similarity(authors_prepub, authors_catalog):
    """Compute fraction of prepublication authors found in catalog author list."""
    if not authors_prepub or not authors_catalog:
        return 0.0
    
    norm_prepub = {normalize_author(a) for a in authors_prepub if normalize_author(a)}
    norm_catalog = {normalize_author(a) for a in authors_catalog if normalize_author(a)}
    
    if not norm_prepub:
        return 0.0
    
    intersection = norm_prepub.intersection(norm_catalog)
    return len(intersection) / len(norm_prepub)

def compute_file_similarity(file_prepub, file_catalog):
    """Compute a similarity score based on summary stats filenames."""
    if not file_prepub or not file_catalog:
        return 0.0
    
    file_prepub = file_prepub.lower()
    file_catalog = file_catalog.lower()
    
    if file_prepub == file_catalog:
        return 1.0
    
    # Extract base names (excluding extensions like .tsv, .gz, .csv from the end)
    base_prepub = re.sub(r"(\.tsv|\.csv|\.gz|\.txt)+$", "", file_prepub)
    base_catalog = re.sub(r"(\.tsv|\.csv|\.gz|\.txt)+$", "", file_catalog)
    
    tokens_prepub = set(re.findall(r"\b\w+\b", base_prepub))
    tokens_catalog = set(re.findall(r"\b\w+\b", base_catalog))
    
    # Exclude common metadata words
    ignore_words = {"sumstats", "summary", "statistics", "data", "file", "gwas"}
    tokens_prepub = tokens_prepub - ignore_words - STOPWORDS
    tokens_catalog = tokens_catalog - ignore_words - STOPWORDS
    
    if not tokens_prepub or not tokens_catalog:
        return 0.0
        
    intersection = tokens_prepub.intersection(tokens_catalog)
    if intersection:
        # Partial match if they share significant keywords (like 'asthma')
        return 0.5
        
    return 0.0

def reconcile_prepub_metadata(prepub_data, catalog_records):
    """
    Compare pre-publication metadata against all catalog records.
    Returns best match, confidence score, and explanation.
    """
    best_record = None
    best_confidence = 0.0
    best_explanation = "No matching records found in mock catalog."
    is_exact = False
    
    prepub_title = prepub_data.get("title", "")
    prepub_authors = prepub_data.get("authors", [])
    prepub_file = prepub_data.get("summary_stats_file", "")
    
    has_title = bool(prepub_title)
    has_authors = bool(prepub_authors)
    has_file = bool(prepub_file)
    
    # Calculate total weight dynamically based on present pre-publication fields
    total_weight = (0.4 if has_title else 0.0) + (0.3 if has_authors else 0.0) + (0.3 if has_file else 0.0)
    if total_weight == 0.0:
        total_weight = 1.0
        
    for record in catalog_records:
        catalog_title = record.get("title", "")
        catalog_authors = record.get("authors", [])
        catalog_file = record.get("summary_stats_file", "")
        
        title_sim = compute_title_similarity(prepub_title, catalog_title) if has_title else 0.0
        author_sim = compute_author_similarity(prepub_authors, catalog_authors) if has_authors else 0.0
        file_sim = compute_file_similarity(prepub_file, catalog_file) if has_file else 0.0
        
        # Weighted overall confidence score dynamically normalized
        weighted_score = (
            (0.4 * title_sim if has_title else 0.0) +
            (0.3 * author_sim if has_authors else 0.0) +
            (0.3 * file_sim if has_file else 0.0)
        )
        confidence = weighted_score / total_weight
        
        if confidence > best_confidence:
            best_confidence = confidence
            best_record = record
            is_exact = (
                (not has_title or title_sim == 1.0) and
                (not has_authors or author_sim == 1.0) and
                (not has_file or file_sim == 1.0)
            )
            
            explanation_parts = [f"Matched catalog study '{catalog_accession(record)}' with confidence {confidence:.2%}."]
            if has_title:
                shared_tokens = sorted(clean_tokens(prepub_title).intersection(clean_tokens(catalog_title)))
                shared_tokens_str = "{" + ", ".join(f"'{t}'" for t in shared_tokens) + "}"
                explanation_parts.append(f"Title Jaccard similarity: {title_sim:.2f} (shared tokens: {shared_tokens_str}).")
            if has_authors:
                explanation_parts.append(f"Author overlap ratio: {author_sim:.2f} (matched prepub authors: {len(set(map(normalize_author, prepub_authors)).intersection(set(map(normalize_author, catalog_authors))))}/{len(prepub_authors)}).")
            if has_file:
                explanation_parts.append(f"Summary stats file matching score: {file_sim:.2f}.")
                
            best_explanation = " ".join(explanation_parts)
            
    # Apply a minimal reconciliation threshold
    if best_confidence < 0.4:
        return {
            "best_match": None,
            "confidence_score": 0.0,
            "explanation": "No catalog record met the minimal confidence threshold of 0.4.",
            "is_exact_match": False
        }
        
    return {
        "best_match": best_record,
        "confidence_score": round(best_confidence, 4),
        "explanation": best_explanation,
        "is_exact_match": is_exact
    }

def catalog_accession(record):
    """Retrieve catalog accession identifier."""
    return record.get("catalog_accession", "UNKNOWN")
