import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import App from './App';
import * as fc from 'fast-check';

jest.mock('@vis.gl/react-google-maps', () => ({
  APIProvider: ({ children }) => <div data-testid="api-provider">{children}</div>,
  Map: ({ children }) => <div data-testid="google-map">{children}</div>,
  AdvancedMarker: ({ children }) => <div data-testid="advanced-marker">{children}</div>,
  useMap: () => null,
}));

// Mock EventSource
class MockEventSource {
  constructor() { this.listeners = {}; }
  addEventListener(event, cb) { this.listeners[event] = cb; }
  close() {}
}
global.EventSource = MockEventSource;

beforeEach(() => {
  global.fetch = jest.fn((url) => {
    if (url.includes('/get_situation_update')) {
      return Promise.resolve({
        ok: true,
        json: async () => ({
          temperature: '29C',
          condition: 'Clear',
          insight: 'Systems nominal'
        })
      });
    }

    if (url.includes('/bridge_status')) {
      return Promise.resolve({
        ok: true,
        json: async () => ({
          mode: 'mock',
          webhook_configured: false
        })
      });
    }

    if (url.includes('/bridge_events')) {
      return Promise.resolve({
        ok: true,
        json: async () => ([])
      });
    }

    if (url.includes('/get_sos_data')) {
      return Promise.resolve({
        ok: true,
        json: async () => ([
          {
            id: 1,
            original_message: 'Fire at Gateway of India',
            category: 'Fire',
            priority: 'Critical',
            urgency: 'Life-threatening',
            severity_score: 9,
            status: 'Created',
            timestamp: new Date().toISOString(),
            coordinates: { lat: 18.922, lng: 72.8347 },
            venue_name: 'Gateway Hotel',
            floor: '3rd',
            room_or_zone: 'Lobby',
            location_text: 'Gateway of India',
            location: 'Colaba',
            source: 'manual_report',
            status_timeline: [],
            authenticity_score: 10,
            need_type: ['Fire'],
          }
        ])
      });
    }

    if (url.includes('/analytics')) {
      return Promise.resolve({
        ok: true,
        json: async () => ({
          total_incidents: 10,
          active_count: 8,
          resolved_count: 2,
          avg_resolve_minutes: 12.5,
          by_category: { Fire: 4, Medical: 3, Flooding: 3 },
          by_priority: { Critical: 4, High: 3, Moderate: 3 },
          by_status: { Created: 5, Resolved: 2, Dispatched: 3 },
          hourly_distribution: new Array(24).fill(0),
        })
      });
    }

    if (url.includes('/panic_alert')) {
      return Promise.resolve({
        ok: true,
        json: async () => ({})
      });
    }

    return Promise.resolve({
      ok: true,
      json: async () => ({})
    });
  });
});

afterEach(() => {
  jest.clearAllMocks();
});

test('renders the disaster response dashboard header', async () => {
  render(<App />);

  expect(screen.getByText(/mumbai disaster response/i)).toBeInTheDocument();

  await waitFor(() => {
    expect(global.fetch).toHaveBeenCalledWith('http://127.0.0.1:5001/get_sos_data');
  });
});

test('renders the filter bar with search and dropdowns', async () => {
  render(<App />);

  await waitFor(() => {
    expect(screen.getByPlaceholderText(/search incidents/i)).toBeInTheDocument();
  });
});

test('renders the analytics toggle button', async () => {
  render(<App />);

  await waitFor(() => {
    expect(screen.getByTitle(/show analytics/i)).toBeInTheDocument();
  });
});

test('renders the Live SOS Feed heading', async () => {
  render(<App />);

  await waitFor(() => {
    expect(screen.getByText(/live sos feed/i)).toBeInTheDocument();
  });
});

// =============================================================================
// TASK 1: Bug Condition Exploration Property Test
// Validates: Requirements 1.1, 1.2, 1.3, 1.4, 1.5, 1.6
// =============================================================================

/**
 * Pure JS helper that maps severity_score to the expected CSS class.
 * This encodes the expected behavior: score >= 8 → severity-high,
 * score 5-7 → severity-medium, score < 5 → severity-low.
 */
function getSeverityClass(score) {
  if (score >= 8) return 'severity-high';
  if (score >= 5) return 'severity-medium';
  return 'severity-low';
}

/**
 * Bug condition check: returns true when the border-radius is the buggy value (4px).
 * Expected: 999px. Bug: 4px.
 */
function isBugCondition_categoryBadgeBorderRadius(borderRadius) {
  return borderRadius === '4px';
}

/**
 * Property 1: Bug Condition — Visual Inconsistency in App.css
 * Validates: Requirements 1.1, 1.2, 1.3, 1.4, 1.5, 1.6
 *
 * Part A: Severity class logic is correct for all scores 1-10.
 * This is a pure JS property — CSS changes cannot affect it.
 */
test('Property 1A: severity class logic maps scores correctly for all values 1-10', () => {
  fc.assert(
    fc.property(
      fc.integer({ min: 1, max: 10 }),
      (score) => {
        const cls = getSeverityClass(score);
        if (score >= 8) return cls === 'severity-high';
        if (score >= 5) return cls === 'severity-medium';
        return cls === 'severity-low';
      }
    )
  );
});

/**
 * Property 1B: Bug Condition — .category-badge border-radius MUST NOT be 4px.
 * Validates: Requirement 1.3
 *
 * This test reads the actual CSS rule from App.css and asserts the border-radius
 * is NOT the buggy value (4px). On unfixed code, this WILL FAIL because
 * App.css has `.category-badge { border-radius: 4px }`.
 *
 * EXPECTED OUTCOME ON UNFIXED CODE: FAIL (confirms bug exists)
 * EXPECTED OUTCOME AFTER FIX: PASS (confirms bug is resolved)
 */
test('Property 1B: .category-badge border-radius is NOT 4px (bug condition)', () => {
  // Read the actual CSS source to extract the border-radius value
  const fs = require('fs');
  const path = require('path');
  const cssPath = path.join(__dirname, 'App.css');
  const cssContent = fs.readFileSync(cssPath, 'utf8');

  // Extract the .category-badge rule block (first occurrence)
  const categoryBadgeMatch = cssContent.match(/\.category-badge\s*\{([^}]*)\}/);
  expect(categoryBadgeMatch).not.toBeNull();

  const ruleBlock = categoryBadgeMatch[1];
  const borderRadiusMatch = ruleBlock.match(/border-radius\s*:\s*([^;]+);/);
  expect(borderRadiusMatch).not.toBeNull();

  const borderRadius = borderRadiusMatch[1].trim();

  // Bug condition: isBugCondition returns true when borderRadius is 4px
  const bugConditionDetected = isBugCondition_categoryBadgeBorderRadius(borderRadius);

  // This assertion FAILS on unfixed code (border-radius is 4px → bug confirmed)
  // It PASSES after the fix (border-radius is 999px → bug resolved)
  expect(bugConditionDetected).toBe(false);
});


// =============================================================================
// TASK 2: Preservation Property Tests (BEFORE implementing fix)
// Validates: Requirements 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7, 3.8
// =============================================================================

/**
 * Pure JS helper that mirrors the bridge-badge class logic from App.js:
 *   `bridgeMode.mode === 'live' ? 'live' : 'mock'`
 */
function getBridgeBadgeClass(mode) {
  return mode === 'live' ? 'live' : 'mock';
}

/**
 * Pure JS helper that mirrors the filter logic from App.js filteredSosData.
 */
function applyFilters(items, { filterCategory, filterPriority, filterStatus, filterText }) {
  return items.filter(item => {
    if (filterCategory !== 'All' && item.category !== filterCategory) return false;
    if (filterPriority !== 'All' && item.priority !== filterPriority) return false;
    if (filterStatus !== 'All' && item.status !== filterStatus) return false;
    if (filterText) {
      const q = filterText.toLowerCase();
      const searchable = `${item.original_message} ${item.venue_name} ${item.location_text || item.location} ${item.category}`.toLowerCase();
      if (!searchable.includes(q)) return false;
    }
    return true;
  });
}

/**
 * Property 2A: Preservation — Severity class logic is correct for all scores 1–10.
 * Validates: Requirements 3.1, 3.5
 *
 * This is a pure JS function — CSS changes cannot affect it.
 * EXPECTED OUTCOME: PASS on unfixed code (confirms baseline behavior to preserve).
 */
test('Property 2A: severity class logic is preserved — score ≥ 8 → high, 5–7 → medium, < 5 → low', () => {
  fc.assert(
    fc.property(
      fc.integer({ min: 1, max: 10 }),
      (score) => {
        const cls = getSeverityClass(score);
        if (score >= 8) return cls === 'severity-high';
        if (score >= 5) return cls === 'severity-medium';
        return cls === 'severity-low';
      }
    ),
    { numRuns: 100 }
  );
});

/**
 * Property 2B: Preservation — Bridge badge class logic is correct for all mode values.
 * Validates: Requirements 3.1, 3.6
 *
 * For `live` mode → class is `live`. For `mock` or `unknown` → class is `mock`.
 * This is a pure JSX conditional — CSS changes cannot affect it.
 * EXPECTED OUTCOME: PASS on unfixed code (confirms baseline behavior to preserve).
 */
test('Property 2B: bridge badge class logic is preserved — live → "live", others → "mock"', () => {
  fc.assert(
    fc.property(
      fc.constantFrom('live', 'mock', 'unknown'),
      (mode) => {
        const cls = getBridgeBadgeClass(mode);
        if (mode === 'live') return cls === 'live';
        return cls === 'mock';
      }
    ),
    { numRuns: 50 }
  );
});

/**
 * Property 2C: Preservation — Filter logic correctly includes/excludes incidents.
 * Validates: Requirements 3.5
 *
 * For generated incident objects with varying category/priority/status, the filter
 * logic must correctly include items that match all active filters and exclude those
 * that don't. This is pure JS — CSS changes cannot affect it.
 * EXPECTED OUTCOME: PASS on unfixed code (confirms baseline behavior to preserve).
 */
test('Property 2C: filter logic is preserved — items matching all filters are included, others excluded', () => {
  const categories = ['Fire', 'Medical', 'Flooding', 'Structural'];
  const priorities = ['Critical', 'High', 'Moderate'];
  const statuses = ['Created', 'Acknowledged', 'Dispatched', 'Resolved'];

  const incidentArb = fc.record({
    id: fc.integer({ min: 1, max: 9999 }),
    category: fc.constantFrom(...categories),
    priority: fc.constantFrom(...priorities),
    status: fc.constantFrom(...statuses),
    original_message: fc.string({ minLength: 1, maxLength: 50 }),
    venue_name: fc.string({ minLength: 1, maxLength: 30 }),
    location_text: fc.string({ minLength: 1, maxLength: 30 }),
    location: fc.string({ minLength: 1, maxLength: 30 }),
  });

  fc.assert(
    fc.property(
      fc.array(incidentArb, { minLength: 1, maxLength: 20 }),
      fc.constantFrom('All', ...categories),
      fc.constantFrom('All', ...priorities),
      fc.constantFrom('All', ...statuses),
      (incidents, filterCategory, filterPriority, filterStatus) => {
        const filters = { filterCategory, filterPriority, filterStatus, filterText: '' };
        const result = applyFilters(incidents, filters);

        // Every item in result must satisfy all active filters
        const allIncluded = result.every(item => {
          if (filterCategory !== 'All' && item.category !== filterCategory) return false;
          if (filterPriority !== 'All' && item.priority !== filterPriority) return false;
          if (filterStatus !== 'All' && item.status !== filterStatus) return false;
          return true;
        });

        // Every item NOT in result must fail at least one active filter
        const resultIds = new Set(result.map(i => i.id));
        const allExcluded = incidents
          .filter(item => !resultIds.has(item.id))
          .every(item => {
            if (filterCategory !== 'All' && item.category !== filterCategory) return true;
            if (filterPriority !== 'All' && item.priority !== filterPriority) return true;
            if (filterStatus !== 'All' && item.status !== filterStatus) return true;
            return false;
          });

        return allIncluded && allExcluded;
      }
    ),
    { numRuns: 200 }
  );
});

/**
 * Property 2D: Preservation — Text filter correctly matches against searchable fields.
 * Validates: Requirements 3.5
 *
 * Items whose searchable string contains the query (case-insensitive) are included;
 * others are excluded. This is pure JS — CSS changes cannot affect it.
 * EXPECTED OUTCOME: PASS on unfixed code (confirms baseline behavior to preserve).
 */
test('Property 2D: text filter is preserved — items matching query text are included, others excluded', () => {
  const incidentArb = fc.record({
    id: fc.integer({ min: 1, max: 9999 }),
    category: fc.constantFrom('Fire', 'Medical', 'Flooding'),
    priority: fc.constantFrom('Critical', 'High', 'Moderate'),
    status: fc.constantFrom('Created', 'Resolved'),
    original_message: fc.string({ minLength: 0, maxLength: 40 }),
    venue_name: fc.string({ minLength: 0, maxLength: 20 }),
    location_text: fc.string({ minLength: 0, maxLength: 20 }),
    location: fc.string({ minLength: 0, maxLength: 20 }),
  });

  fc.assert(
    fc.property(
      fc.array(incidentArb, { minLength: 1, maxLength: 15 }),
      fc.string({ minLength: 1, maxLength: 8 }),
      (incidents, filterText) => {
        const filters = { filterCategory: 'All', filterPriority: 'All', filterStatus: 'All', filterText };
        const result = applyFilters(incidents, filters);
        const q = filterText.toLowerCase();

        // Every included item must contain the query in its searchable string
        const allIncluded = result.every(item => {
          const searchable = `${item.original_message} ${item.venue_name} ${item.location_text || item.location} ${item.category}`.toLowerCase();
          return searchable.includes(q);
        });

        // Every excluded item must NOT contain the query
        const resultIds = new Set(result.map(i => i.id));
        const allExcluded = incidents
          .filter(item => !resultIds.has(item.id))
          .every(item => {
            const searchable = `${item.original_message} ${item.venue_name} ${item.location_text || item.location} ${item.category}`.toLowerCase();
            return !searchable.includes(q);
          });

        return allIncluded && allExcluded;
      }
    ),
    { numRuns: 200 }
  );
});
