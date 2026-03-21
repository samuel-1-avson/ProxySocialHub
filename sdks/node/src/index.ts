import { v4 as uuidv4 } from 'uuid';
import axios, { AxiosRequestConfig, AxiosResponse } from 'axios';
import { HttpsProxyAgent } from 'https-proxy-agent';

export interface ProxyConfig {
  gatewayUrl: string;
  proxyAuth?: string;
}

export class ProxyHubbClient {
  private gatewayUrl: string;
  private proxyAuth: string;
  private currentSessionId: string;

  /**
   * Official ProxyHubb Node.js SDK (Phase 7).
   * 
   * @param config - Gateway URL and optional proxy authentication.
   */
  constructor(config: ProxyConfig) {
    this.gatewayUrl = config.gatewayUrl || 'http://localhost:8080';
    this.proxyAuth = config.proxyAuth || 'anonymous';
    this.currentSessionId = uuidv4();
  }

  /**
   * Generates a proxy agent for Axios or other HTTP clients.
   * 
   * @param rotate - If true, a new session ID will be generated.
   * @returns An HttpsProxyAgent instance.
   */
  getProxyAgent(rotate = false): HttpsProxyAgent<string> {
    if (rotate) {
      this.currentSessionId = uuidv4();
    }

    // Format: http://user:session@gateway:port
    const gatewayHost = this.gatewayUrl.replace(/^https?:\/\//, '');
    const proxyUrl = `http://${this.proxyAuth}:${this.currentSessionId}@${gatewayHost}`;
    
    return new HttpsProxyAgent(proxyUrl);
  }

  /**
   * High-level request wrapper using Axios.
   */
  async request<T = any>(
    config: AxiosRequestConfig & { rotate?: boolean }
  ): Promise<AxiosResponse<T>> {
    const { rotate, ...axiosConfig } = config;
    
    const agent = this.getProxyAgent(rotate);
    
    try {
      return await axios({
        ...axiosConfig,
        httpAgent: agent,
        httpsAgent: agent,
        // Disable proxy env vars to ensure our agent is used
        proxy: false,
      });
    } catch (error) {
      // P7-W20: Smart retry on failure
      if (rotate === false) {
          console.warn('ProxyHubb Node SDK: Request failed. Retrying with fresh session...');
          return this.request({ ...config, rotate: true });
      }
      throw error;
    }
  }
}

// Example Usage:
// const client = new ProxyHubbClient({ proxyAuth: 'user123' });
// const response = await client.request({ method: 'get', url: 'https://api.ipify.org' });
