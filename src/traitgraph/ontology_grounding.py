def ground_trait_locally(reported_trait):
    """
    Perform local, deterministic ontology grounding of reported trait strings to mock EFO IDs.
    Flags compound concepts and lists reasons for manual review if grounding is approximate or synonym-based.
    """
    if not reported_trait or not isinstance(reported_trait, str):
        return {
            "ontology_id": None,
            "ontology_label": None,
            "grounding_type": "failed",
            "contains_multiple_concepts": False,
            "manual_review_required": True,
            "review_reasons": ["Reported trait is empty, missing, or not a string."]
        }
        
    normalized = reported_trait.lower().strip()
    
    # Check for indicators of multiple/compound concepts (e.g. slashes, commas, 'and')
    contains_multiple = False
    multiple_reasons = []
    if "/" in normalized:
        contains_multiple = True
        multiple_reasons.append("Reported trait contains slash '/' character indicating alternative or joint phenotypes.")
    if "," in normalized:
        contains_multiple = True
        multiple_reasons.append("Reported trait contains comma ',' indicating compound categories.")
    if " and " in normalized:
        contains_multiple = True
        multiple_reasons.append("Reported trait contains 'and' conjunction indicating multiple phenotypes.")

    # Local mock database of ontology mappings
    ontology_db = {
        "childhood wheeze/asthma": {
            "ontology_id": "MONDO:0005405",
            "ontology_label": "childhood onset asthma",
            "grounding_type": "approximate",
            "reasons": ["Grounding is approximate for combined wheeze/asthma phenotype."]
        },
        "childhood asthma": {
            "ontology_id": "MONDO:0005405",
            "ontology_label": "childhood onset asthma",
            "grounding_type": "synonym",
            "reasons": ["Grounding is synonym-based (childhood asthma normalized to childhood onset asthma)."]
        },
        "asthma": {
            "ontology_id": "MONDO:0004979",
            "ontology_label": "asthma",
            "grounding_type": "exact",
            "reasons": []
        },
        "type 2 diabetes": {
            "ontology_id": "MONDO:0005148",
            "ontology_label": "type 2 diabetes mellitus",
            "grounding_type": "exact",
            "reasons": []
        },
        "adult onset asthma": {
            "ontology_id": "EFO:1002011",
            "ontology_label": "adult onset asthma",
            "grounding_type": "exact",
            "reasons": []
        }
    }
    
    match = ontology_db.get(normalized)
    
    if match:
        ontology_id = match["ontology_id"]
        ontology_label = match["ontology_label"]
        grounding_type = match["grounding_type"]
        reasons = list(match["reasons"])
    else:
        # Fallback keyword checking for approximate matching
        if "asthma" in normalized:
            ontology_id = "MONDO:0004979"
            ontology_label = "asthma"
            grounding_type = "approximate"
            reasons = ["Fallback keyword mapping: matched 'asthma' as substring of trait expression."]
        elif "diabetes" in normalized:
            ontology_id = "MONDO:0005148"
            ontology_label = "type 2 diabetes mellitus"
            grounding_type = "approximate"
            reasons = ["Fallback keyword mapping: matched 'diabetes' as substring of trait expression."]
        else:
            ontology_id = None
            ontology_label = None
            grounding_type = "failed"
            reasons = [f"No matching ontology term in local database for '{reported_trait}'."]
            
    # Combine multi-concept flags and other reasons
    all_reasons = []
    if contains_multiple:
        all_reasons.extend(multiple_reasons)
    all_reasons.extend(reasons)
    
    # Manual review is required if grounding is not exact, if there are multiple concepts, or if it failed entirely
    manual_review = (grounding_type != "exact") or contains_multiple or (grounding_type == "failed")
    
    return {
        "ontology_id": ontology_id,
        "ontology_label": ontology_label,
        "grounding_type": grounding_type,
        "contains_multiple_concepts": contains_multiple,
        "manual_review_required": manual_review,
        "review_reasons": all_reasons
    }
