import { render, screen, waitFor } from '@testing-library/react';
import App from './App';

jest.mock('@vis.gl/react-google-maps', () => ({
  APIProvider: ({ children }) => <div data-testid="api-provider">{children}</div>,
  Map: ({ children }) => <div data-testid="google-map">{children}</div>,
  AdvancedMarker: ({ children }) => <div data-testid="advanced-marker">{children}</div>,
  useMap: () => null,
}));

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
        json: async () => ([])
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
