import uuid
from datetime import datetime, timezone

def create_graph_ready_json(prepub_data, match_result, grounding_result):
    """
    Format GWAS reconciliation and grounding outputs into a structured, provenance-rich,
    and graph-ready JSON schema with explicit curator review flags.
    """
    review_reasons = []
    
    # Check 1: Study Match Flags
    best_match = match_result.get("best_match")
    confidence_score = match_result.get("confidence_score", 0.0)
    is_exact_study = match_result.get("is_exact_match", False)
    
    if not best_match:
        review_reasons.append("No matching record found in mock catalog.")
    elif not is_exact_study:
        review_reasons.append(
            f"Study match is probable rather than exact (Confidence: {confidence_score:.2%})."
        )
        if confidence_score < 0.70:
            review_reasons.append("Study match confidence score is low (< 70%).")

    # Check 2: Grounding and Concept Flags
    grounding_review = grounding_result.get("manual_review_required", False)
    grounding_reasons = grounding_result.get("review_reasons", [])
    
    if grounding_review or grounding_reasons:
        review_reasons.extend(grounding_reasons)
        
    # Determine overall manual review requirement
    manual_review_required = (not best_match) or (not is_exact_study) or grounding_review or (confidence_score < 0.70)
    
    # Deduplicate reasons
    unique_reasons = []
    for r in review_reasons:
        if r not in unique_reasons:
            unique_reasons.append(r)
            
    # Structure graph JSON
    graph_node = {
        "graph_schema_version": "1.0.0",
        "entity_id": f"traitgraph-node-{uuid.uuid4()}",
        
        # Exact submitted metadata preserved
        "submitted_metadata": prepub_data,
        
        # Catalog matching details
        "matched_catalog_record": best_match,
        
        "reconciliation": {
            "confidence_score": confidence_score,
            "explanation": match_result.get("explanation", ""),
            "is_exact_match": is_exact_study
        },
        
        # Ontology mapping details
        "normalized_trait": {
            "ontology_id": grounding_result.get("ontology_id"),
            "ontology_label": grounding_result.get("ontology_label"),
            "grounding_type": grounding_result.get("grounding_type"),
            "contains_multiple_concepts": grounding_result.get("contains_multiple_concepts", False)
        },
        
        # Provenance record
        "provenance": {
            "tool_name": "TraitGraph GWAS Reconciler MVP",
            "tool_version": "0.1.0",
            "timestamp": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
            "run_id": str(uuid.uuid4())
        },
        
        # Review indicators for curators
        "review_flags": {
            "manual_review_required": manual_review_required,
            "reasons": unique_reasons
        }
    }
    
    return graph_node
