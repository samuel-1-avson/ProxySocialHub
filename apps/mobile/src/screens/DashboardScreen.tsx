import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  RefreshControl,
} from 'react-native';
import * as SecureStore from 'expo-secure-store';

const API_URL = 'http://localhost:8080/v1';

interface Stats {
  activeSessions: number;
  balance: number;
  bandwidthUsed: number;
  bandwidthLimit: number;
}

export default function DashboardScreen() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  async function fetchStats() {
    try {
      const token = await SecureStore.getItemAsync('access_token');
      const [sessionsRes, walletRes] = await Promise.all([
        fetch(`${API_URL}/sessions`, {
          headers: { Authorization: `Bearer ${token}` },
        }),
        fetch(`${API_URL}/wallet`, {
          headers: { Authorization: `Bearer ${token}` },
        }),
      ]);

      const sessions = await sessionsRes.json();
      const wallet = await walletRes.json();

      setStats({
        activeSessions: sessions.sessions?.filter((s: any) => s.status === 'active').length || 0,
        balance: wallet.wallet?.balance || 0,
        bandwidthUsed: 2.5, // Mock
        bandwidthLimit: 10, // Mock
      });
    } catch (error) {
      console.error('Failed to fetch stats:', error);
      // Mock data
      setStats({
        activeSessions: 2,
        balance: 45.50,
        bandwidthUsed: 2.5,
        bandwidthLimit: 10,
      });
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }

  useEffect(() => {
    fetchStats();
  }, []);

  function onRefresh() {
    setRefreshing(true);
    fetchStats();
  }

  if (loading) {
    return (
      <View style={styles.loadingContainer}>
        <Text style={styles.loadingText}>Loading...</Text>
      </View>
    );
  }

  return (
    <ScrollView
      style={styles.container}
      refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#f97316" />
      }
    >
      <View style={styles.header}>
        <Text style={styles.greeting}>Welcome back! 👋</Text>
        <Text style={styles.subtitle}>Your proxy network at a glance</Text>
      </View>

      <View style={styles.statsGrid}>
        <StatCard
          title="Balance"
          value={`GHS ${stats?.balance.toFixed(2)}`}
          icon="💰"
          color="#22c55e"
        />
        <StatCard
          title="Active Sessions"
          value={String(stats?.activeSessions)}
          icon="🔗"
          color="#3b82f6"
        />
        <StatCard
          title="Bandwidth Used"
          value={`${stats?.bandwidthUsed} GB`}
          icon="📊"
          color="#a855f7"
        />
        <StatCard
          title="Remaining"
          value={`${(stats?.bandwidthLimit || 0) - (stats?.bandwidthUsed || 0)} GB`}
          icon="📈"
          color="#f97316"
        />
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Quick Actions</Text>
        <View style={styles.actionsGrid}>
          <ActionButton title="New Session" icon="➕" />
          <ActionButton title="Top Up" icon="💳" />
          <ActionButton title="View Usage" icon="📊" />
          <ActionButton title="Settings" icon="⚙️" />
        </View>
      </View>
    </ScrollView>
  );
}

function StatCard({ title, value, icon, color }: { title: string; value: string; icon: string; color: string }) {
  return (
    <View style={[styles.statCard, { borderLeftColor: color }]}>
      <Text style={styles.statIcon}>{icon}</Text>
      <Text style={styles.statValue}>{value}</Text>
      <Text style={styles.statTitle}>{title}</Text>
    </View>
  );
}

function ActionButton({ title, icon }: { title: string; icon: string }) {
  return (
    <TouchableOpacity style={styles.actionButton}>
      <Text style={styles.actionIcon}>{icon}</Text>
      <Text style={styles.actionText}>{title}</Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0f0f1a',
  },
  loadingContainer: {
    flex: 1,
    backgroundColor: '#0f0f1a',
    justifyContent: 'center',
    alignItems: 'center',
  },
  loadingText: {
    color: '#fff',
    fontSize: 18,
  },
  header: {
    padding: 24,
    paddingTop: 16,
  },
  greeting: {
    fontSize: 28,
    fontWeight: 'bold',
    color: '#fff',
  },
  subtitle: {
    fontSize: 14,
    color: '#888',
    marginTop: 4,
  },
  statsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    padding: 12,
  },
  statCard: {
    width: '46%',
    backgroundColor: '#1a1a2e',
    borderRadius: 16,
    padding: 16,
    margin: '2%',
    borderLeftWidth: 4,
  },
  statIcon: {
    fontSize: 24,
    marginBottom: 8,
  },
  statValue: {
    fontSize: 22,
    fontWeight: 'bold',
    color: '#fff',
  },
  statTitle: {
    fontSize: 12,
    color: '#888',
    marginTop: 4,
  },
  section: {
    padding: 24,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: '#fff',
    marginBottom: 16,
  },
  actionsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
  },
  actionButton: {
    width: '47%',
    backgroundColor: '#1a1a2e',
    borderRadius: 12,
    padding: 16,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#333',
  },
  actionIcon: {
    fontSize: 28,
    marginBottom: 8,
  },
  actionText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '500',
  },
});
