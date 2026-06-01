import React from 'react';
import {
  relationshipLabel,
  relationshipBadgeClass,
  resultTypeLabel,
  catalogStatusLabel,
  catalogStatusBadgeClass,
  resultTypeBadgeClass,
  identifierMatchLabel,
  identifierMatchBadgeClass,
  topMatchLinks,
  filterUnlinkedCatalogStudies,
} from './discoverApi';

function VerifyRow({ label, value }) {
  if (!value) return null;
  return (
    <div style={{ marginBottom: '0.5rem' }}>
      <div style={{ fontSize: '0.65rem', textTransform: 'uppercase', color: 'var(--text-muted)', fontWeight: '600', letterSpacing: '0.04em', marginBottom: '0.15rem' }}>
        {label}
      </div>
      <div style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', lineHeight: '1.45' }}>
        {value}
      </div>
    </div>
  );
}

function TopMatchVerification({ submission, topMatch }) {
  if (!topMatch) return null;

  const signals = topMatch.match_signals || {};
  const links = topMatchLinks(topMatch);
  const inputAuthors = (submission?.authors || []).join(', ');
  const matchAuthors = (topMatch.authors || []).slice(0, 8).join(', ');
  const moreAuthors = (topMatch.authors || []).length > 8
    ? ` (+${topMatch.authors.length - 8} more)`
    : '';

  return (
    <div style={{
      marginTop: '1rem',
      padding: '1rem',
      borderRadius: '8px',
      background: 'var(--card-bg)',
      border: '1px solid var(--card-border)',
    }}>
      <div style={{ fontSize: '0.75rem', fontWeight: '700', color: 'var(--link-accent)', marginBottom: '0.75rem', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
        Verify top match
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '1rem', marginBottom: '0.75rem' }}>
        <div>
          <div style={{ fontSize: '0.7rem', fontWeight: '700', color: 'var(--text-muted)', marginBottom: '0.5rem' }}>Your submission</div>
          <VerifyRow label="Title" value={submission?.title} />
          <VerifyRow label="Authors" value={inputAuthors || null} />
          <VerifyRow label="Trait" value={submission?.reported_trait} />
        </div>
        <div>
          <div style={{ fontSize: '0.7rem', fontWeight: '700', color: 'var(--text-muted)', marginBottom: '0.5rem' }}>Top match</div>
          <VerifyRow label="Title" value={topMatch.title} />
          <VerifyRow label="Authors" value={matchAuthors ? `${matchAuthors}${moreAuthors}` : null} />
          <VerifyRow label="Type" value={resultTypeLabel(topMatch.result_type, topMatch)} />
          {topMatch.gwas_catalog_linked && topMatch.accession_id && (
            <VerifyRow label="GWAS Catalog" value={`Indexed as ${topMatch.accession_id}`} />
          )}
          {topMatch.accession_id && <VerifyRow label="GCST" value={topMatch.accession_id} />}
          {topMatch.pmid && <VerifyRow label="PMID" value={topMatch.pmid} />}
          {topMatch.doi && <VerifyRow label="DOI" value={topMatch.doi} />}
        </div>
      </div>

      <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: '0.75rem' }}>
        Match signals: title {(signals.title_jaccard * 100).toFixed(0)}%
        · authors {(signals.author_overlap * 100).toFixed(0)}%
        {signals.trait_overlap > 0 && ` · trait ${(signals.trait_overlap * 100).toFixed(0)}%`}
        {signals.file_similarity > 0 && ` · file ${(signals.file_similarity * 100).toFixed(0)}%`}
        · overall {(signals.combined_score * 100).toFixed(0)}%
      </div>

      {links.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem' }}>
          {links.map((link) => (
            <a
              key={link.key}
              href={link.href}
              target="_blank"
              rel="noreferrer"
              style={{
                fontSize: '0.75rem',
                padding: '0.35rem 0.65rem',
                borderRadius: '6px',
                background: 'rgba(99, 102, 241, 0.12)',
                border: '1px solid rgba(99, 102, 241, 0.35)',
                color: 'var(--link-secondary)',
                textDecoration: 'none',
                fontWeight: '600',
              }}
            >
              {link.label} ↗
            </a>
          ))}
        </div>
      )}
    </div>
  );
}

function CollapsibleEvidencePanel({
  icon,
  title,
  description,
  note,
  defaultOpen = true,
  border,
  children,
}) {
  return (
    <details
      className="glass-panel evidence-details"
      open={defaultOpen}
      style={{ padding: '1rem 1.25rem', border }}
    >
      <summary>
        <span style={{ fontSize: '1.25rem', lineHeight: 1.2 }} aria-hidden="true">{icon}</span>
        <span className="evidence-details-text">
          <span className="evidence-details-title">{title}</span>
          {description && <span className="evidence-details-desc">{description}</span>}
          {note && <span className="evidence-details-note">{note}</span>}
        </span>
        <span className="evidence-details-toggle" aria-hidden="true" />
      </summary>
      <div className="evidence-details-body">{children}</div>
    </details>
  );
}

function LinkChips({ links }) {
  if (!links?.length) return null;
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem', marginTop: '0.65rem' }}>
      {links.map((link) => (
        <a
          key={link.key}
          href={link.href}
          target="_blank"
          rel="noreferrer"
          style={{
            fontSize: '0.75rem',
            padding: '0.35rem 0.65rem',
            borderRadius: '6px',
            background: 'rgba(99, 102, 241, 0.12)',
            border: '1px solid rgba(99, 102, 241, 0.35)',
            color: 'var(--link-secondary)',
            textDecoration: 'none',
            fontWeight: '600',
          }}
        >
          {link.label} ↗
        </a>
      ))}
    </div>
  );
}

function ResultCard({
  item,
  getConfidenceColor,
  showTypeBadge = true,
  showVerificationLinks = false,
  sectionRank,
}) {
  const signals = item.match_signals || {};
  const statusLabel = catalogStatusLabel(item.catalog_status);
  const idMatchLabel = identifierMatchLabel(signals.identifier_match);
  const verificationLinks = showVerificationLinks ? topMatchLinks(item) : [];
  const displayRank = sectionRank ?? item.rank;

  return (
    <div style={{
      background: 'var(--card-bg)', border: '1px solid var(--card-border)',
      borderRadius: '8px', padding: '1rem',
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: '0.75rem', flexWrap: 'wrap', marginBottom: '0.5rem' }}>
        <span style={{ fontWeight: '700', color: 'var(--link-accent)', fontSize: '0.8rem' }}>#{displayRank}</span>
        <div style={{ display: 'flex', gap: '0.35rem', flexWrap: 'wrap' }}>
          {showTypeBadge && (
            <span className={`badge ${resultTypeBadgeClass(item.result_type)}`} style={{ fontSize: '0.65rem' }}>
              {resultTypeLabel(item.result_type, item)}
            </span>
          )}
          {statusLabel && (
            <span className={`badge ${catalogStatusBadgeClass(item.catalog_status)}`} style={{ fontSize: '0.65rem' }}>
              {statusLabel}
            </span>
          )}
          <span className={`badge ${relationshipBadgeClass(item.relationship)}`} style={{ fontSize: '0.65rem' }}>
            {relationshipLabel(item.relationship)}
          </span>
          {idMatchLabel && (
            <span className={`badge ${identifierMatchBadgeClass(signals.identifier_match)}`} style={{ fontSize: '0.65rem' }}>
              {idMatchLabel}
            </span>
          )}
        </div>
      </div>

      <h4 style={{ color: 'var(--heading-color)', fontSize: '0.95rem', lineHeight: '1.4', margin: '0 0 0.5rem 0' }}>
        {item.url ? (
          <a href={item.url} target="_blank" rel="noreferrer" style={{ color: 'var(--heading-color)', textDecoration: 'none' }}>
            {item.title} ↗
          </a>
        ) : item.title}
      </h4>

      <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', display: 'flex', flexWrap: 'wrap', gap: '0.75rem' }}>
        {item.accession_id && <span>GCST: {item.accession_id}</span>}
        {item.pmid && <span>PMID: {item.pmid}</span>}
        {item.reported_trait && <span>Trait: {item.reported_trait}</span>}
        {item.year && <span>Year: {item.year}</span>}
        {item.doi && <span>DOI: {item.doi}</span>}
        {item.full_summary_stats && <span>Sumstats available</span>}
        {item.summary_stats_url && (
          <span>
            <a href={item.summary_stats_url} target="_blank" rel="noreferrer" style={{ color: 'var(--link-secondary)' }}>
              Sumstats FTP ↗
            </a>
          </span>
        )}
        {signals.file_similarity > 0 && (
          <span>File match: {(signals.file_similarity * 100).toFixed(0)}%</span>
        )}
        <span>Score: {((signals.combined_score || 0) * 100).toFixed(0)}%</span>
      </div>

      <LinkChips links={verificationLinks} />

      <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginTop: '0.35rem' }}>
        via {(item.sources || [item.source]).filter(Boolean).join(' + ')}
        {item.skill ? ` · ${item.skill}` : ''}
        {!showVerificationLinks && item.catalog_url && (
          <>
            {' · '}
            <a href={item.catalog_url} target="_blank" rel="noreferrer" style={{ color: 'var(--link-secondary)' }}>
              Catalog ↗
            </a>
          </>
        )}
      </div>
    </div>
  );
}

export default function DiscoveryResults({
  isReconciling,
  relatedResults = [],
  publicationResults,
  catalogStudyResults,
  submission,
  discoverySummary,
  sameStudyAssessment,
  identifierResolution,
  getConfidenceColor,
}) {
  const summary = discoverySummary || sameStudyAssessment || {};
  const topMatch = summary.top_match;
  const conf = summary.confidence || 0;
  const rel = summary.relationship || 'no_match';

  const publications = publicationResults ?? relatedResults.filter(
    (r) => r.result_type === 'catalog_publication' || r.result_type === 'literature',
  );
  const allCatalogStudies = catalogStudyResults ?? relatedResults.filter(
    (r) => r.result_type === 'catalog_study',
  );
  const unlinkedCatalogStudies = filterUnlinkedCatalogStudies(allCatalogStudies, publications);
  const linkedCatalogStudyCount = allCatalogStudies.length - unlinkedCatalogStudies.length;
  const totalPublications = summary.publication_count ?? publications.length;
  const totalCatalogStudies = summary.catalog_study_count ?? allCatalogStudies.length;
  const publicationsApiCapped = publications.length < totalPublications;
  const catalogStudiesApiCapped = allCatalogStudies.length < totalCatalogStudies;
  const prepublishedUnlinkedCount = unlinkedCatalogStudies.filter(
    (s) => s.catalog_status === 'prepublished',
  ).length;
  const publicationsDefaultOpen = publications.length > 0;
  const gwasStudiesDescription = [
    'Pre-publication sumstats always listed here',
    prepublishedUnlinkedCount > 0 ? ` (${prepublishedUnlinkedCount} pre-pub)` : '',
    unlinkedCatalogStudies.length > prepublishedUnlinkedCount
      ? `, plus ${unlinkedCatalogStudies.length - prepublishedUnlinkedCount} study-only Catalog ${unlinkedCatalogStudies.length - prepublishedUnlinkedCount === 1 ? 'hit' : 'hits'}`
      : '',
    '.',
    linkedCatalogStudyCount > 0
      ? ` Published Catalog ${linkedCatalogStudyCount === 1 ? 'study' : 'studies'} linked above are omitted.`
      : '',
  ].join('');
  const gwasOnlyDefaultOpen = publications.length === 0
    ? unlinkedCatalogStudies.length > 0
    : unlinkedCatalogStudies.some((s) => s.catalog_status === 'prepublished');

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem', position: 'relative', minWidth: 0 }}>
      {isReconciling && (
        <div style={{
          position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
          background: 'var(--overlay-bg)', backdropFilter: 'blur(8px)', zIndex: 10,
          borderRadius: 'var(--radius-lg)', display: 'flex', flexDirection: 'column',
          alignItems: 'center', justifyContent: 'center', gap: '1rem',
          border: '1px solid rgba(99, 102, 241, 0.2)',
        }}>
          <h3 className="glow-text" style={{ color: 'var(--accent-primary)', fontWeight: '700', fontSize: '1.3rem' }}>
            Searching GWAS Catalog + literature…
          </h3>
          <p style={{ color: 'var(--text-secondary)', fontSize: '0.85rem' }}>
            GWAS Catalog Solr · OpenAlex · Europe PMC · PubMed
          </p>
        </div>
      )}

      <div className="glass-panel" style={{ padding: '1.75rem', border: '1px solid rgba(56, 189, 248, 0.25)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem', flexWrap: 'wrap', gap: '0.75rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <span style={{ fontSize: '1.25rem' }}>🔍</span>
            <h3 style={{ fontSize: '1.2rem', color: 'var(--heading-color)', fontWeight: '700', margin: 0 }}>Discovery Summary</h3>
          </div>
          <span className={`badge ${relationshipBadgeClass(rel)}`}>
            {relationshipLabel(rel)}
          </span>
        </div>
        <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem', lineHeight: '1.5', marginBottom: '0.75rem' }}>
          {summary.explanation}
        </p>
        {identifierResolution && (identifierResolution.gcst_extracted || identifierResolution.doi_normalized) && (
          <p style={{
            color: 'var(--text-muted)', fontSize: '0.8rem', marginBottom: '0.75rem',
            padding: '0.5rem 0.75rem', borderRadius: '6px',
            background: 'rgba(99, 102, 241, 0.08)', border: '1px solid rgba(99, 102, 241, 0.2)',
          }}>
            {identifierResolution.gcst_extracted && (
              <span>GCST anchor: {identifierResolution.gcst_extracted}. </span>
            )}
            {identifierResolution.doi_normalized && (
              <span>DOI anchor: {identifierResolution.doi_normalized}. </span>
            )}
            {(identifierResolution.anchor_hit_count ?? 0) > 0 && (
              <span>{identifierResolution.anchor_hit_count} identifier match(es).</span>
            )}
          </p>
        )}
        {(summary.degraded_sources?.length > 0) && (
          <p style={{
            color: 'var(--accent-warning)', fontSize: '0.8rem', marginBottom: '0.75rem',
            padding: '0.5rem 0.75rem', borderRadius: '6px',
            background: 'rgba(245, 158, 11, 0.08)', border: '1px solid rgba(245, 158, 11, 0.25)',
          }}>
            Some sources were unavailable: {summary.degraded_sources.join(', ')}. Results may be incomplete.
          </p>
        )}
        {(summary.search_context) && (
          <p style={{
            color: 'var(--text-muted)', fontSize: '0.8rem', lineHeight: '1.45',
            marginBottom: '0.75rem', padding: '0.5rem 0.75rem', borderRadius: '6px',
            background: 'rgba(255,255,255,0.03)', border: '1px solid var(--divider)',
          }}>
            {summary.search_context}
          </p>
        )}
        <div style={{ width: '100%', height: '6px', background: 'var(--divider)', borderRadius: '3px', overflow: 'hidden', marginBottom: topMatch ? '0' : undefined }}>
          <div style={{
            width: `${(conf * 100).toFixed(0)}%`,
            height: '100%',
            background: getConfidenceColor(conf),
          }} />
        </div>
        <TopMatchVerification submission={submission} topMatch={topMatch} />
      </div>

      <CollapsibleEvidencePanel
        icon="📚"
        title={`Related Publications (${publications.length})`}
        description="Primary evidence: published papers from PubMed, Europe PMC, OpenAlex, and GWAS Catalog publication records. GCST study links appear here when a paper is indexed in the Catalog."
        note={publicationsApiCapped
          ? `Showing top ${publications.length} of ${totalPublications} publication matches by score (response limit).`
          : null}
        defaultOpen={publicationsDefaultOpen}
        border="1px solid rgba(129, 140, 248, 0.35)"
      >
        {publications.length === 0 ? (
          <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem' }}>
            No publications found in literature or GWAS Catalog publication records. Check GWAS Catalog studies below for pre-pub sumstats or study-only hits.
          </p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
            {publications.map((item, index) => (
              <ResultCard
                key={`pub-${item.rank}-${item.pmid || item.doi || item.title}`}
                item={item}
                sectionRank={index + 1}
                getConfidenceColor={getConfidenceColor}
                showVerificationLinks
              />
            ))}
          </div>
        )}
      </CollapsibleEvidencePanel>

      {unlinkedCatalogStudies.length > 0 && (
        <CollapsibleEvidencePanel
          icon="🧬"
          title={`Additional GWAS Catalog studies (${unlinkedCatalogStudies.length})`}
          description={gwasStudiesDescription}
          note={catalogStudiesApiCapped
            ? 'Catalog study search returned more than shown; list includes unlinked studies from the API response.'
            : null}
          defaultOpen={gwasOnlyDefaultOpen}
          border="1px solid rgba(16, 185, 129, 0.25)"
        >
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
            {unlinkedCatalogStudies.map((item, index) => (
              <ResultCard
                key={`study-${item.rank}-${item.accession_id || item.title}`}
                item={item}
                sectionRank={index + 1}
                getConfidenceColor={getConfidenceColor}
                showTypeBadge={false}
                showVerificationLinks
              />
            ))}
          </div>
        </CollapsibleEvidencePanel>
      )}
    </div>
  );
}
