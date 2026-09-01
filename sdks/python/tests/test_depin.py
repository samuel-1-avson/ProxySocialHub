"""Test DePIN and P2P extensions on ProxyHubClient."""

import os
import sys
import unittest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from proxyhubb.client import ProxyHubClient


class TestDePINSDK(unittest.TestCase):
    def setUp(self):
        self.client = ProxyHubClient(
            api_key="phub_test_key_123",
            base_url="https://api.testnet.proxyhubb.com",
            proxy_endpoint="proxy.testnet.proxyhubb.com:8090",
        )

    def test_methods_exist(self):
        self.assertTrue(callable(getattr(self.client, "create_p2p_signal_offer", None)))
        self.assertTrue(callable(getattr(self.client, "create_p2p_signal_answer", None)))
        self.assertTrue(callable(getattr(self.client, "get_p2p_signals", None)))
        self.assertTrue(callable(getattr(self.client, "get_gateway_operators", None)))
        self.assertTrue(callable(getattr(self.client, "get_depin_mining_stats", None)))

    def test_validation(self):
        with self.assertRaises(ValueError):
            self.client.get_p2p_signals("")


if __name__ == "__main__":
    unittest.main()
