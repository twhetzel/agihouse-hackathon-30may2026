import urllib.request
import urllib.parse
import json

def search_ols(query, ontology="efo"):
    encoded_query = urllib.parse.quote(query)
    url = f"https://www.ebi.ac.uk/ols4/api/search?q={encoded_query}&ontology={ontology}&exact=true"
    print(f"Querying OLS URL: {url}")
    try:
        req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
        with urllib.request.urlopen(req, timeout=10) as response:
            data = json.loads(response.read().decode('utf-8'))
            results = data.get("response", {}).get("docs", [])
            print(f"Found {len(results)} exact matches:")
            for doc in results:
                print(f" - Label: {doc.get('label')}")
                print(f"   OBO ID: {doc.get('obo_id')}")
                print(f"   Short Form: {doc.get('short_form')}")
                print(f"   IRI: {doc.get('iri')}")
                print(f"   Ontology: {doc.get('ontology_name')}")
    except Exception as e:
        print(f"Error querying OLS: {e}")

print("--- Asthma ---")
search_ols("asthma")

print("--- Childhood Asthma ---")
search_ols("childhood asthma")

print("--- Type 2 Diabetes ---")
search_ols("type 2 diabetes")

print("--- Adult onset asthma ---")
search_ols("adult onset asthma")
