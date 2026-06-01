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
    print(f"Error importing GWAS PrePubMatch modules. Python path is: {sys.path}")
    print(f"Original error: {e}")
    sys.exit(1)

def main():
    print("=" * 80)
    print("        GWAS PREPUBMATCH — LEGACY CATALOG RECONCILER DEMO")
    print("=" * 80)
    
    catalog_path = os.path.join(project_root, "resources", "traitgraph_mock_catalog_records.json")
    output_dir = os.path.join(project_root, "outputs")
    
    if not os.path.exists(catalog_path):
        print(f"[-] ERROR: Mock catalog file not found at: {catalog_path}")
        sys.exit(1)
        
    print(f"[+] Loading mock curated GWAS Catalog records: {os.path.basename(catalog_path)}")
    with open(catalog_path, 'r') as f:
        catalog_records = json.load(f)
        
    scenarios = [
        {
            "name": "ORIGINAL MVP DEMO",
            "desc": "Childhood wheeze/asthma with probable study match and approximate grounding",
            "input_file": "traitgraph_messy_asthma_prepub.json",
            "output_file": "traitgraph_reconciled_asthma_graph.json"
        },
        {
            "name": "SCENARIO 1: HIGH-CONFIDENCE MATCH",
            "desc": "Childhood asthma with identical title/authors/stats-file (100% study match)",
            "input_file": "traitgraph_scenario_1_high_confidence.json",
            "output_file": "traitgraph_scenario_1_high_confidence.json"
        },
        {
            "name": "SCENARIO 2: AMBIGUOUS TRAIT MATCH",
            "desc": "wheeze/asthma/allergy mapping to multiple ontology concepts (triggers manual review)",
            "input_file": "traitgraph_scenario_2_ambiguous_trait.json",
            "output_file": "traitgraph_scenario_2_ambiguous_trait.json"
        },
        {
            "name": "SCENARIO 3: NO CONFIDENT CATALOG MATCH",
            "desc": "Similar title but completely different cohort/authors (shows system does not over-match)",
            "input_file": "traitgraph_scenario_3_no_match.json",
            "output_file": "traitgraph_scenario_3_no_match.json"
        }
    ]
    
    results_summary = []
    
    for idx, sc in enumerate(scenarios):
        prepub_path = os.path.join(project_root, "examples", sc["input_file"])
        output_path = os.path.join(output_dir, sc["output_file"])
        
        if not os.path.exists(prepub_path):
            print(f"[-] ERROR: Pre-publication file not found for {sc['name']} at: {prepub_path}")
            continue
            
        with open(prepub_path, 'r') as f:
            prepub_data = json.load(f)
            
        print("\n" + "-" * 80)
        print(f"▶ RUNNING {sc['name']}")
        print(f"  Description : {sc['desc']}")
        print(f"  Input Title : '{prepub_data.get('title')}'")
        print(f"  Input Trait : '{prepub_data.get('reported_trait')}'")
        print(f"  Input Auth  : {prepub_data.get('authors')}")
        print("-" * 80)
        
        # 1. Study Reconciliation
        reconcile_result = reconcile_prepub_metadata(prepub_data, catalog_records)
        best_match = reconcile_result.get("best_match")
        confidence = reconcile_result.get("confidence_score", 0.0)
        
        # 2. Ontology Grounding
        grounding_result = ground_trait_locally(prepub_data.get("reported_trait"))
        
        # 3. Export Schema Generation
        graph_json = create_graph_ready_json(prepub_data, reconcile_result, grounding_result)
        
        # Save file
        os.makedirs(output_dir, exist_ok=True)
        with open(output_path, 'w') as f:
            json.dump(graph_json, f, indent=4)
            
        print(f"[+] Output written to: outputs/{sc['output_file']}")
        
        # Accumulate summary metrics
        results_summary.append({
            "name": sc["name"],
            "reported_trait": prepub_data.get('reported_trait'),
            "matched_study": f"{best_match.get('catalog_accession')} ({best_match.get('publication_id')})" if best_match else "NONE",
            "confidence": f"{confidence:.2%}" if best_match else "0.00%",
            "ontology_id": graph_json['normalized_trait']['ontology_id'] or "FAILED",
            "grounding_type": graph_json['normalized_trait']['grounding_type'].upper(),
            "manual_review": "YES ⚠️" if graph_json['review_flags']['manual_review_required'] else "NO ✅",
            "reasons": graph_json['review_flags']['reasons']
        })
        
    # BEAUTIFUL COMPARISON DASHBOARD
    print("\n" + "=" * 80)
    print("                    FINAL MULTI-SCENARIO METRIC COMPARISON")
    print("=" * 80)
    
    # Print a beautiful table-like layout
    row_fmt = "║ {name:<32} │ {trait:<22} │ {match:<14} │ {conf:<8} │ {review:<6} ║"
    print("╔" + "═" * 34 + "╤" + "═" * 24 + "╤" + "═" * 16 + "╤" + "═" * 10 + "╤" + "═" * 8 + "╗")
    print(row_fmt.format(name="Scenario", trait="Reported Trait", match="Matched Study", conf="Confidence", review="Review?"))
    print("╠" + "═" * 34 + "╪" + "═" * 24 + "╪" + "═" * 16 + "╪" + "═" * 10 + "╪" + "═" * 8 + "╣")
    
    for r in results_summary:
        # Pad strings for columns
        name_short = r["name"][:32]
        trait_short = r["reported_trait"][:22]
        match_short = r["matched_study"][:14]
        print(row_fmt.format(
            name=name_short,
            trait=trait_short,
            match=match_short,
            conf=r["confidence"],
            review=r["manual_review"]
        ))
        
    print("╚" + "═" * 34 + "╧" + "═" * 24 + "╧" + "═" * 16 + "╧" + "═" * 10 + "╧" + "═" * 8 + "╝")
    
    print("\n" + "=" * 80)
    print("                       SCENARIO DRILLDOWN ANALYSIS")
    print("=" * 80)
    for r in results_summary:
        print(f"\n★ {r['name']}")
        print(f"  • Reported Phenotype : '{r['reported_trait']}'")
        print(f"  • Matched Accession  : {r['matched_study']} (Confidence: {r['confidence']})")
        print(f"  • Grounded Ontology  : {r['ontology_id']} ({r['grounding_type']})")
        print(f"  • Manual Review Req. : {r['manual_review']}")
        if r['reasons']:
            print("  • Trigger Reasons    :")
            for reason in r['reasons']:
                print(f"    - {reason}")
                
    print("\n" + "=" * 80)
    print("               MVP DEMO CONCLUDED SUCCESSFULLY WITH ALL SCENARIOS")
    print("=" * 80)

if __name__ == '__main__':
    main()
