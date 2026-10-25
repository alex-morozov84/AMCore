/** Internal fault source and offline Grafana, only in a fresh isolated E2E stand. */
export function consoleSummaryServices(m) {
  if (m.fixtureProfile !== 'console-summary') return null
  if (m.purpose !== 'e2e' || m.mocked || m.topology !== 'path' || !m.consoleEnabled)
    throw new Error('Console summary requires a fresh path-mode E2E stand')
  const mount = `${m.snapshot}/docker/testing/console-summary`
  return {
    'summary-source': {
      image: `${m.project}-api:latest`,
      init: true,
      command: ['node', '/app/fixtures/source.mjs'],
      volumes: [`${mount}/source.mjs:/app/fixtures/source.mjs:ro`],
      healthcheck: {
        test: [
          'CMD',
          'node',
          '-e',
          "fetch('http://127.0.0.1:8098/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))",
        ],
        interval: '2s',
        timeout: '2s',
        retries: 20,
      },
    },
    'summary-grafana': {
      image:
        'grafana/grafana:13.2.1@sha256:f772d434e8fab0049deb2b1b30abd43342bcfca1537614aa8d36080232cf4283',
      ports: [`127.0.0.1:${m.ports.tls}:3000`],
      environment: {
        GF_AUTH_ANONYMOUS_ENABLED: 'true',
        GF_AUTH_ANONYMOUS_ORG_ROLE: 'Viewer',
        GF_AUTH_DISABLE_LOGIN_FORM: 'true',
        GF_PLUGINS_PREINSTALL_DISABLED: 'true',
        GF_ANALYTICS_REPORTING_ENABLED: 'false',
        GF_ANALYTICS_CHECK_FOR_UPDATES: 'false',
        GF_ANALYTICS_CHECK_FOR_PLUGIN_UPDATES: 'false',
      },
      volumes: [
        `${mount}/grafana/provisioning:/etc/grafana/provisioning:ro`,
        `${mount}/grafana/dashboards:/var/lib/grafana/dashboards:ro`,
      ],
    },
  }
}
