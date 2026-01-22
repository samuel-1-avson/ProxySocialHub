import React, { useState, useEffect, useCallback } from 'react';
import { View, Text, StyleSheet, FlatList, TouchableOpacity, ActivityIndicator, Image, RefreshControl, Alert, Modal, TextInput, ScrollView } from 'react-native';
import { Ionicons, FontAwesome5, MaterialCommunityIcons } from '@expo/vector-icons';
import * as WebBrowser from 'expo-web-browser';
import { getWallet, getTransactions, depositWallet, withdrawWallet, Wallet, WalletTransaction } from '../../src/api/wallet';
import { useAuth } from '../../src/context/AuthContext';

export default function WalletScreen() {
    const [wallet, setWallet] = useState<Wallet | null>(null);
    const [transactions, setTransactions] = useState<WalletTransaction[]>([]);
    const [loading, setLoading] = useState(true);
    const [refreshing, setRefreshing] = useState(false);
    const { user } = useAuth();

    // Modal States
    const [depositModalVisible, setDepositModalVisible] = useState(false);
    const [withdrawModalVisible, setWithdrawModalVisible] = useState(false);

    // Form States
    const [amount, setAmount] = useState('');
    const [phone, setPhone] = useState('');
    const [network, setNetwork] = useState('MTN'); // Default network
    const [processing, setProcessing] = useState(false);

    const fetchData = async () => {
        try {
            const [walletData, txData] = await Promise.all([
                getWallet(),
                getTransactions()
            ]);
            setWallet(walletData);
            setTransactions(txData.transactions || []);
        } catch (error) {
            console.error("Wallet Fetch Error:", error);
            // Alert.alert("Error", "Failed to load wallet data");
        } finally {
            setLoading(false);
            setRefreshing(false);
        }
    };

    useEffect(() => {
        fetchData();
    }, []);

    const onRefresh = useCallback(() => {
        setRefreshing(true);
        fetchData();
    }, []);

    const handleDeposit = async () => {
        if (!amount || isNaN(Number(amount))) {
            Alert.alert("Invalid Amount", "Please enter a valid amount");
            return;
        }
        setProcessing(true);
        try {
            const email = user?.email || "user@example.com";
            const res = await depositWallet(Number(amount), email);

            // Open Paystack URL
            if (res.authorization_url) {
                await WebBrowser.openBrowserAsync(res.authorization_url);
                // After returning, refresh wallet (could be improved with deep link verification)
                Alert.alert("Payment Initiated", "Check your mobile money / card to complete the transaction.");
                setDepositModalVisible(false);
                setAmount('');
                fetchData();
            }
        } catch (error: any) {
            Alert.alert("Deposit Failed", error.message || "Something went wrong");
        } finally {
            setProcessing(false);
        }
    };

    const handleWithdraw = async () => {
        if (!amount || isNaN(Number(amount))) {
            Alert.alert("Invalid Amount", "Please enter a valid amount");
            return;
        }
        if (!phone) {
            Alert.alert("Invalid Phone", "Please enter a phone number");
            return;
        }

        setProcessing(true);
        try {
            const res = await withdrawWallet(Number(amount), phone, network);
            Alert.alert("Success", `Withdrawal of GHS ${amount} initiated to ${network} ${phone}. Reference: ${res.reference}`);
            setWithdrawModalVisible(false);
            setAmount('');
            setPhone('');
            fetchData();
        } catch (error: any) {
            Alert.alert("Withdrawal Failed", error.message || "Insufficient funds or network error");
        } finally {
            setProcessing(false);
        }
    };


    const renderTransaction = ({ item }: { item: WalletTransaction }) => {
        const isCredit = item.type === 'deposit' || item.type === 'earning' || item.type === 'refund';
        return (
            <View style={styles.txCard}>
                <View style={[styles.txIcon, isCredit ? styles.bgGreen : styles.bgRed]}>
                    <Ionicons
                        name={isCredit ? "arrow-down-outline" : "arrow-up-outline"}
                        size={20}
                        color={isCredit ? "#059669" : "#DC2626"}
                    />
                </View>
                <View style={styles.txContent}>
                    <Text style={styles.txDesc}>{item.description || item.type.toUpperCase()}</Text>
                    <Text style={styles.txDate}>{new Date(item.created_at).toLocaleDateString()}</Text>
                </View>
                <Text style={[styles.txAmount, isCredit ? styles.textGreen : styles.textRed]}>
                    {isCredit ? '+' : '-'} GHS {item.amount.toFixed(2)}
                </Text>
            </View>
        );
    };

    if (loading) {
        return (
            <View style={styles.loadingContainer}>
                <ActivityIndicator size="large" color="#2563EB" />
            </View>
        );
    }

    return (
        <View className="flex-1 bg-background">
            <View className="pt-16 pb-6 px-6 bg-card border-b-2 border-border flex-row justify-between items-center">
                <View>
                    <Text className="text-[10px] font-black text-muted-foreground uppercase tracking-[0.2em]">Asset Terminal</Text>
                    <Text className="text-3xl font-black text-foreground uppercase tracking-tighter">Financial_Core</Text>
                </View>
                <TouchableOpacity onPress={fetchData} className="p-2 bg-secondary border border-border rounded-sm">
                    <Ionicons name="sync" size={18} color="#18181B" />
                </TouchableOpacity>
            </View>

            <ScrollView
                refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#059669" />}
                className="flex-1"
                contentContainerStyle={{ padding: 20 }}
            >
                {/* Balance Card */}
                <View className="bg-primary/5 border-2 border-primary p-6 mb-8 rounded-sm shadow-[4px_4px_0px_#18181B]">
                    <View className="flex-row justify-between items-center mb-6">
                        <Text className="text-[10px] font-black text-primary uppercase tracking-[0.2em]">Settlement_Balance</Text>
                        <MaterialCommunityIcons name="finance" size={20} color="#059669" />
                    </View>
                    <View className="flex-row items-baseline gap-2 mb-6">
                        <Text className="text-xs font-bold text-muted-foreground uppercase">₵</Text>
                        <Text className="text-5xl font-black text-foreground tabular-nums tracking-tighter">
                            {wallet?.balance?.toFixed(2) || '0.00'}
                        </Text>
                    </View>
                    <View className="flex-row items-center gap-2 border-t border-primary/20 pt-4">
                        <Ionicons name="shield-checkmark-outline" size={14} color="#059669" />
                        <Text className="text-[9px] font-bold text-muted-foreground uppercase tracking-widest">
                            {wallet?.linked_solana_address ? `Vault: ${wallet.linked_solana_address.slice(0, 6)}...` : 'Identity_Verification_Pending'}
                        </Text>
                    </View>
                </View>

                {/* Actions */}
                <View className="flex-row gap-4 mb-10">
                    <TouchableOpacity
                        className="flex-1 bg-primary p-4 items-center justify-center rounded-sm shadow-[2px_2px_0px_#18181B]"
                        onPress={() => setDepositModalVisible(true)}
                    >
                        <Ionicons name="arrow-down" size={24} color="#FFF" />
                        <Text className="text-[10px] font-black text-white uppercase mt-2">Deposit</Text>
                    </TouchableOpacity>

                    <TouchableOpacity
                        className="flex-1 bg-card border-2 border-border p-4 items-center justify-center rounded-sm"
                        onPress={() => setWithdrawModalVisible(true)}
                    >
                        <Ionicons name="arrow-up" size={24} color="#18181B" />
                        <Text className="text-[10px] font-black text-foreground uppercase mt-2">Withdraw</Text>
                    </TouchableOpacity>
                </View>

                {/* Transactions */}
                <View className="flex-row justify-between items-center mb-6">
                    <Text className="text-xs font-black text-muted-foreground uppercase tracking-widest">Transaction_Ledger</Text>
                    <View className="h-0.5 flex-1 bg-border/30 ml-4" />
                </View>

                <FlatList
                    data={transactions}
                    keyExtractor={(item) => item.id}
                    scrollEnabled={false}
                    renderItem={({ item }) => {
                        const isCredit = item.type === 'deposit' || item.type === 'earning' || item.type === 'refund';
                        return (
                            <View className="bg-card border-2 border-border p-4 mb-3 rounded-sm flex-row items-center">
                                <View className={`w-10 h-10 border border-border items-center justify-center rounded-sm ${isCredit ? 'bg-primary/10' : 'bg-destructive/10'}`}>
                                    <Ionicons
                                        name={isCredit ? "download-outline" : "share-outline"}
                                        size={18}
                                        color={isCredit ? "#059669" : "#DC2626"}
                                    />
                                </View>
                                <View className="flex-1 ml-4">
                                    <Text className="text-[11px] font-black text-foreground uppercase" numberOfLines={1}>{item.description || item.type}</Text>
                                    <Text className="text-[8px] font-bold text-muted-foreground uppercase mt-1">{new Date(item.created_at).toLocaleDateString()}</Text>
                                </View>
                                <Text className={`font-black text-sm tabular-nums ${isCredit ? 'text-primary' : 'text-destructive'}`}>
                                    {isCredit ? '+' : '-'} {item.amount.toFixed(2)}
                                </Text>
                            </View>
                        );
                    }}
                    ListEmptyComponent={
                        <View className="py-12 items-center justify-center border-2 border-dashed border-border rounded-sm">
                            <Ionicons name="file-tray-outline" size={32} color="#D1D5DB" />
                            <Text className="mt-2 text-[9px] font-black text-muted-foreground uppercase tracking-widest">Digital_Ledger_Empty</Text>
                        </View>
                    }
                />
            </ScrollView>


            {/* Deposit Modal */}
            <Modal
                visible={depositModalVisible}
                animationType="slide"
                transparent={true}
                onRequestClose={() => setDepositModalVisible(false)}
            >
                <View style={styles.modalOverlay}>
                    <View style={styles.modalContent}>
                        <View style={styles.modalHeader}>
                            <Text style={styles.modalTitle}>Deposit Funds</Text>
                            <TouchableOpacity onPress={() => setDepositModalVisible(false)}>
                                <Ionicons name="close" size={24} color="#6B7280" />
                            </TouchableOpacity>
                        </View>
                        <Text style={styles.modalSubtitle}>Enter amount to deposit via Paystack (Card/Mobile Money)</Text>

                        <TextInput
                            style={styles.input}
                            placeholder="Amount (GHS)"
                            keyboardType="numeric"
                            value={amount}
                            onChangeText={setAmount}
                        />

                        <TouchableOpacity
                            style={styles.modalButton}
                            onPress={handleDeposit}
                            disabled={processing}
                        >
                            {processing ? (
                                <ActivityIndicator color="#FFF" />
                            ) : (
                                <Text style={styles.modalButtonText}>Iniate Payment</Text>
                            )}
                        </TouchableOpacity>
                    </View>
                </View>
            </Modal>

            {/* Withdraw Modal */}
            <Modal
                visible={withdrawModalVisible}
                animationType="slide"
                transparent={true}
                onRequestClose={() => setWithdrawModalVisible(false)}
            >
                <View style={styles.modalOverlay}>
                    <View style={styles.modalContent}>
                        <View style={styles.modalHeader}>
                            <Text style={styles.modalTitle}>Withdraw Funds</Text>
                            <TouchableOpacity onPress={() => setWithdrawModalVisible(false)}>
                                <Ionicons name="close" size={24} color="#6B7280" />
                            </TouchableOpacity>
                        </View>
                        <Text style={styles.modalSubtitle}>Withdraw to Mobile Money</Text>

                        <TextInput
                            style={styles.input}
                            placeholder="Amount (GHS)"
                            keyboardType="numeric"
                            value={amount}
                            onChangeText={setAmount}
                        />

                        <TextInput
                            style={styles.input}
                            placeholder="Phone Number (e.g. 0541234567)"
                            keyboardType="phone-pad"
                            value={phone}
                            onChangeText={setPhone}
                        />

                        <View style={styles.networkSelector}>
                            {['MTN', 'VOD', 'AIR'].map(net => (
                                <TouchableOpacity
                                    key={net}
                                    style={[styles.netOption, network === net && styles.netOptionSelected]}
                                    onPress={() => setNetwork(net)}
                                >
                                    <Text style={[styles.netText, network === net && styles.netTextSelected]}>{net}</Text>
                                </TouchableOpacity>
                            ))}
                        </View>

                        <TouchableOpacity
                            style={styles.modalButton}
                            onPress={handleWithdraw}
                            disabled={processing}
                        >
                            {processing ? (
                                <ActivityIndicator color="#FFF" />
                            ) : (
                                <Text style={styles.modalButtonText}>Withdraw Now</Text>
                            )}
                        </TouchableOpacity>
                    </View>
                </View>
            </Modal>
        </View>
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
        backgroundColor: '#F9FAFB',
    },
    loadingContainer: {
        flex: 1,
        justifyContent: 'center',
        alignItems: 'center',
    },
    header: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        paddingTop: 60,
        paddingBottom: 16,
        paddingHorizontal: 20,
        backgroundColor: '#FFF',
    },
    headerTitle: {
        fontSize: 24,
        fontWeight: '900',
        color: '#111827',
    },
    scrollContent: {
        padding: 20,
    },
    balanceCard: {
        backgroundColor: '#2563EB',
        borderRadius: 20,
        padding: 24,
        marginBottom: 24,
        shadowColor: '#2563EB',
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.3,
        shadowRadius: 8,
        elevation: 6,
    },
    balanceLabel: {
        color: '#BFDBFE',
        fontSize: 14,
        fontWeight: 'bold',
        textTransform: 'uppercase',
        letterSpacing: 1,
        marginBottom: 8,
    },
    balanceAmount: {
        color: '#FFFFFF',
        fontSize: 36,
        fontWeight: '900',
    },
    balanceRow: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'flex-end',
        marginTop: 20,
    },
    cryptoBadge: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: 'rgba(255,255,255,0.2)',
        paddingHorizontal: 12,
        paddingVertical: 6,
        borderRadius: 20,
        gap: 8,
    },
    cryptoText: {
        color: '#FFF',
        fontSize: 12,
        fontWeight: 'bold',
        fontFamily: 'monospace',
    },
    actionsContainer: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        marginBottom: 32,
    },
    actionBtn: {
        alignItems: 'center',
        flex: 1,
    },
    actionIcon: {
        width: 56,
        height: 56,
        borderRadius: 28,
        justifyContent: 'center',
        alignItems: 'center',
        marginBottom: 8,
    },
    actionLabel: {
        fontSize: 12,
        fontWeight: '600',
        color: '#4B5563',
    },
    sectionTitle: {
        fontSize: 18,
        fontWeight: 'bold',
        color: '#111827',
        marginBottom: 16,
    },
    txCard: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: '#FFF',
        padding: 16,
        borderRadius: 12,
        marginBottom: 12,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 1 },
        shadowOpacity: 0.05,
        shadowRadius: 2,
        elevation: 1,
    },
    txIcon: {
        width: 40,
        height: 40,
        borderRadius: 20,
        justifyContent: 'center',
        alignItems: 'center',
        marginRight: 12,
    },
    bgGreen: { backgroundColor: '#D1FAE5' },
    bgRed: { backgroundColor: '#FEE2E2' },
    txContent: {
        flex: 1,
    },
    txDesc: {
        fontSize: 14,
        fontWeight: 'bold',
        color: '#111827',
        marginBottom: 2,
    },
    txDate: {
        fontSize: 12,
        color: '#9CA3AF',
    },
    txAmount: {
        fontSize: 14,
        fontWeight: 'bold',
    },
    textGreen: { color: '#059669' },
    textRed: { color: '#DC2626' },
    emptyContainer: {
        alignItems: 'center',
        padding: 20,
    },
    emptyText: {
        color: '#9CA3AF',
    },
    // Modal Styles
    modalOverlay: {
        flex: 1,
        backgroundColor: 'rgba(0,0,0,0.5)',
        justifyContent: 'flex-end',
    },
    modalContent: {
        backgroundColor: '#FFF',
        borderTopLeftRadius: 24,
        borderTopRightRadius: 24,
        padding: 24,
        paddingBottom: 40,
    },
    modalHeader: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: 8,
    },
    modalTitle: {
        fontSize: 20,
        fontWeight: 'bold',
        color: '#111827',
    },
    modalSubtitle: {
        fontSize: 14,
        color: '#6B7280',
        marginBottom: 24,
    },
    input: {
        backgroundColor: '#F3F4F6',
        borderRadius: 12,
        padding: 16,
        fontSize: 16,
        marginBottom: 16,
    },
    networkSelector: {
        flexDirection: 'row',
        gap: 12,
        marginBottom: 24,
    },
    netOption: {
        flex: 1,
        paddingVertical: 12,
        borderRadius: 8,
        borderWidth: 1,
        borderColor: '#E5E7EB',
        alignItems: 'center',
    },
    netOptionSelected: {
        borderColor: '#2563EB',
        backgroundColor: '#EFF6FF',
    },
    netText: {
        fontWeight: 'bold',
        color: '#4B5563',
    },
    netTextSelected: {
        color: '#2563EB',
    },
    modalButton: {
        backgroundColor: '#2563EB',
        borderRadius: 12,
        paddingVertical: 16,
        alignItems: 'center',
    },
    modalButtonText: {
        color: '#FFF',
        fontSize: 16,
        fontWeight: 'bold',
    },
});
