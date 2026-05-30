#!/usr/bin/env python3
import os
import sys
import json

# Add project source directory to Python path
script_dir = os.path.dirname(os.path.abspath(__file__))
project_root = os.path.abspath(os.path.join(script_dir, "..", "..", "..", ".."))
src_dir = os.path.join(project_root, "src")
sys.path.insert(0, src_dir)

try:
    from traitgraph.reconcile import reconcile_prepub_metadata  # type: ignore
    from traitgraph.ontology_grounding import ground_trait_locally  # type: ignore
    from traitgraph.export import create_graph_ready_json  # type: ignore
except ImportError as e:
    print(f"Error importing TraitGraph modules. Python path is: {sys.path}")
    print(f"Original error: {e}")
    sys.exit(1)

def main():
    print("=" * 70)
    print("      TRAITGRAPH GWAS RECONCILER - HACKATHON MVP DEMO DRIVER")
    print("=" * 70)
    
    # Path configuration
    prepub_path = os.path.join(project_root, "examples", "traitgraph_messy_asthma_prepub.json")
    catalog_path = os.path.join(project_root, "resources", "traitgraph_mock_catalog_records.json")
    output_dir = os.path.join(project_root, "outputs")
    output_path = os.path.join(output_dir, "traitgraph_reconciled_asthma_graph.json")
    
    # Load input files
    if not os.path.exists(prepub_path):
        print(f"[-] ERROR: Input pre-publication file not found at: {prepub_path}")
        sys.exit(1)
    if not os.path.exists(catalog_path):
        print(f"[-] ERROR: Mock catalog file not found at: {catalog_path}")
        sys.exit(1)
        
    print(f"[+] Loading pre-publication GWAS metadata: {os.path.basename(prepub_path)}")
    with open(prepub_path, 'r') as f:
        prepub_data = json.load(f)
        
    print(f"[+] Loading mock curated GWAS Catalog records: {os.path.basename(catalog_path)}")
    with open(catalog_path, 'r') as f:
        catalog_records = json.load(f)
        
    print("-" * 70)
    print(f"Input Title : '{prepub_data.get('title')}'")
    print(f"Input Trait : '{prepub_data.get('reported_trait')}'")
    print(f"Input Auth  : {prepub_data.get('authors')}")
    print("-" * 70)
    
    # 1. Study Reconciliation
    print("[*] Running Study Reconciliation Engine...")
    reconcile_result = reconcile_prepub_metadata(prepub_data, catalog_records)
    best_match = reconcile_result.get("best_match")
    confidence = reconcile_result.get("confidence_score", 0.0)
    
    # 2. Ontology Grounding
    print("[*] Running Ontology Grounding Engine...")
    grounding_result = ground_trait_locally(prepub_data.get("reported_trait"))
    
    # 3. Export Schema Generation
    print("[*] Compiling Graph-Ready Evidentiary Record...")
    graph_json = create_graph_ready_json(prepub_data, reconcile_result, grounding_result)
    
    # Save file
    os.makedirs(output_dir, exist_ok=True)
    with open(output_path, 'w') as f:
        json.dump(graph_json, f, indent=4)
        
    print("[+] Successfully wrote output graph node!")
    print(f"    Path: {output_path}")
    print("=" * 70)
    
    # BEAUTIFUL TERMINAL DASHBOARD
    print("                    DEMO EXECUTION DASHBOARD")
    print("=" * 70)
    
    if best_match:
        print(f"🏆 MATCHED STUDY     : {best_match.get('catalog_accession')} ({best_match.get('publication_id')})")
        print(f"   Matched Title    : '{best_match.get('title')}'")
        print(f"   Match Confidence : {confidence:.2%} (Probable Match)")
        print(f"   Match Explanation: {reconcile_result.get('explanation')}")
    else:
        print("❌ MATCHED STUDY     : NONE (Below confidence threshold)")
        
    print("-" * 70)
    print(f"🧬 GROUNDED ONTOLOGY : {graph_json['normalized_trait']['ontology_id']} ({graph_json['normalized_trait']['ontology_label']})")
    print(f"   Grounding Type   : {graph_json['normalized_trait']['grounding_type'].upper()}")
    print(f"   Multi-concept    : {graph_json['normalized_trait']['contains_multiple_concepts']}")
    
    print("-" * 70)
    review_flags = graph_json.get("review_flags", {})
    if review_flags.get("manual_review_required"):
        print("⚠️  CURATOR ACTION REQUIRED: YES [MANUAL REVIEW REQUIRED]")
        for i, reason in enumerate(review_flags.get("reasons", []), 1):
            print(f"    {i}. {reason}")
    else:
        print("✅ CURATOR ACTION REQUIRED: NO [AUTOMATICALLY GROUNDED & RECONCILED]")
        
    print("-" * 70)
    print(f"📝 RUN PROVENANCE    :")
    print(f"   Tool Name        : {graph_json['provenance']['tool_name']}")
    print(f"   Run Timestamp    : {graph_json['provenance']['timestamp']}")
    print(f"   Execution UUID   : {graph_json['provenance']['run_id']}")
    print("=" * 70)
    print("               MVP DEMO CONCLUDED SUCCESSFULLY")
    print("=" * 70)

if __name__ == '__main__':
    main()
