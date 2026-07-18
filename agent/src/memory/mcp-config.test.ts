import { describe, it, expect } from 'vitest';
import { resolveMcpServerConfigs } from './mcp-config.js';

const GW = 'https://gw-abc.gateway.bedrock-agentcore.us-east-1.amazonaws.com/mcp';

describe('resolveMcpServerConfigs', () => {
  it('folds a static authHeader into headers, after user headers, and strips the field', () => {
    const out = resolveMcpServerConfigs({
      blog: { url: GW, headers: { 'x-v': '1' }, authHeader: { name: 'x-auth', value: 'tok' } },
    });
    expect(out.blog.headers).toEqual({ 'x-v': '1', 'x-auth': 'tok' });
    expect('authHeader' in out.blog).toBe(false);
  });

  it('forwards the connection token as Authorization for an allowlisted host', () => {
    const out = resolveMcpServerConfigs(
      { blog: { url: GW, transport: 'streamable-http', forwardConnectionToken: true } },
      { connectionToken: 'jwt-123', allowedHosts: ['gw-abc.gateway.bedrock-agentcore.us-east-1.amazonaws.com'] },
    );
    expect(out.blog.headers).toEqual({ Authorization: 'Bearer jwt-123' });
    expect('forwardConnectionToken' in out.blog).toBe(false);
  });

  it('REFUSES to forward the token to a non-allowlisted host (no credential leak)', () => {
    const out = resolveMcpServerConfigs(
      { evil: { url: 'https://attacker.example/mcp', forwardConnectionToken: true } },
      { connectionToken: 'jwt-123', allowedHosts: ['gw-abc.gateway.bedrock-agentcore.us-east-1.amazonaws.com'] },
    );
    expect(out.evil.headers?.Authorization).toBeUndefined();
  });

  it('does not forward when there is no connection token, or the allowlist is empty', () => {
    const noToken = resolveMcpServerConfigs(
      { blog: { url: GW, forwardConnectionToken: true } },
      { allowedHosts: ['gw-abc.gateway.bedrock-agentcore.us-east-1.amazonaws.com'] },
    );
    expect(noToken.blog.headers?.Authorization).toBeUndefined();

    const noAllowlist = resolveMcpServerConfigs(
      { blog: { url: GW, forwardConnectionToken: true } },
      { connectionToken: 'jwt-123' }, // allowedHosts defaults to []
    );
    expect(noAllowlist.blog.headers?.Authorization).toBeUndefined();
  });

  it('leaves a server without either mechanism untouched', () => {
    const out = resolveMcpServerConfigs({ docs: { url: 'https://tools.example/mcp' } });
    expect(out.docs).toEqual({ url: 'https://tools.example/mcp' });
  });
});
