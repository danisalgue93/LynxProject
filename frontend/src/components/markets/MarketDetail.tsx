import React, { useState, useEffect } from "react";
import { Market, Position, Duel } from "@/src/types";
import {
  Area,
  AreaChart,
  ResponsiveContainer,
  XAxis,
  YAxis,
  Tooltip as RechartsTooltip,
  CartesianGrid,
  Line,
  LineChart,
} from "recharts";
import {
  X,
  TrendingUp,
  ShieldCheck,
  Zap,
  Info,
  BarChart3,
  Clock,
  ArrowRight,
  Sword,
  Wallet,
} from "lucide-react";
import { useWalletModal } from "@solana/wallet-adapter-react-ui";
import { motion, AnimatePresence } from "motion/react";
import { formatSOL, cn } from "@/src/lib/utils";
import { useProgram } from "@/src/hooks/useProgram";
import { useBlockchainTransaction } from "@/src/hooks/useBlockchainTransaction";
import { useToast } from "@/src/context/ToastContext";
import { apiUrl } from "@/src/lib/api";
import { useTranslation } from "react-i18next";

interface MarketDetailProps {
  market: Market;
  onClose: () => void;
  readOnly?: boolean;
  onAuthRequired?: (action: string) => void;
  onHostDuel?: () => void;
}

function MiniMarketChart({
  isLynx,
  market,
}: {
  isLynx: boolean;
  market: Market;
}) {
  const { t } = useTranslation();
  const [historicalData, setHistoricalData] = useState<any[]>([]);

  useEffect(() => {
    let cancelled = false;
    const loadHistory = async () => {
      try {
        const response = await fetch(apiUrl(`/api/chart/klines?marketId=${encodeURIComponent(market.id)}&interval=1h&limit=48`));
        const candles = await response.json();
        if (!cancelled && Array.isArray(candles)) {
          setHistoricalData(candles.map((candle: any) => {
            const yes = Math.max(0, Math.min(100, Number(candle.close) * 100));
            return {
              time: candle.time,
              YES: yes,
              NO: market.isTernary ? Math.max(0, (100 - yes) / 2) : Math.max(0, 100 - yes),
              DRAW: market.isTernary ? Math.max(0, (100 - yes) / 2) : 0,
            };
          }));
        }
      } catch (err) {
        console.error("Failed to load market chart history", err);
      }
    };
    loadHistory();
    return () => {
      cancelled = true;
    };
  }, [market.id, market.isTernary]);

  const total =
    (market.yesAmount || 0) + (market.noAmount || 0) + (market.drawAmount || 0);
  const yesProb = total > 0 ? ((market.yesAmount || 0) / total) * 100 : 0;
  const noProb = total > 0 ? ((market.noAmount || 0) / total) * 100 : 0;
  const drawProb = market.isTernary
    ? total > 0 ? ((market.drawAmount || 0) / total) * 100 : 0
    : 0;
  const snapshotData = total > 0
    ? [
        { time: 0, YES: yesProb, NO: noProb, DRAW: drawProb },
        { time: 1, YES: yesProb, NO: noProb, DRAW: drawProb },
      ]
    : [];
  const chartData = historicalData.length > 0 ? historicalData : snapshotData;

  if (total <= 0 && chartData.length === 0) {
    return (
      <div className="w-full h-full flex items-center justify-center text-[10px] text-[#71717A] uppercase font-bold tracking-widest">
        {t("marketDetail.noTradesYet", "No trades yet")}
      </div>
    );
  }

  return (
    <div className="w-full h-full">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart
          data={chartData}
          margin={{ top: 10, right: 0, left: -20, bottom: 0 }}
        >
          <CartesianGrid
            strokeDasharray="3 3"
            stroke="#27272A"
            vertical={false}
          />
          <XAxis dataKey="time" hide />
          <YAxis
            domain={[0, 100]}
            stroke="#52525B"
            fontSize={10}
            tickFormatter={(val) => `${val}%`}
          />
          <RechartsTooltip
            contentStyle={{
              backgroundColor: "#0D0D0E",
              border: "1px solid #27272A",
              borderRadius: "4px",
            }}
            labelStyle={{ display: "none" }}
          />
          <Area
            type="monotone"
            dataKey="YES"
            stackId="1"
            stroke="#00FFD1"
            fill="#00FFD1"
            fillOpacity={0.2}
          />
          <Area
            type="monotone"
            dataKey="NO"
            stackId="2"
            stroke="#F87171"
            fill="#F87171"
            fillOpacity={0.2}
          />
          {market?.isTernary && (
            <Area
              type="monotone"
              dataKey="DRAW"
              stackId="3"
              stroke="#60A5FA"
              fill="#60A5FA"
              fillOpacity={0.2}
            />
          )}
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

export function MarketDetail({
  market,
  onClose,
  readOnly = false,
  onAuthRequired,
  onHostDuel,
}: MarketDetailProps) {
  const { t } = useTranslation();
  const { fetchDuels, executeTrade, fetchPositions, claimPosition } =
    useProgram();
  const { executeTransaction } = useBlockchainTransaction();
  const { addToast } = useToast();
  const [marketDuels, setMarketDuels] = useState<Duel[]>([]);

  const [betAmount, setBetAmount] = useState("5.0");
  const [selectedSide, setSelectedSide] = useState<Position>(Position.YES);
  const [isPending, setIsPending] = useState(false);
  const [claimablePosId, setClaimablePosId] = useState<string | null>(null);
  const [isClaiming, setIsClaiming] = useState(false);
  const [claimResult, setClaimResult] = useState<{
    payout: number;
    currency: string;
  } | null>(null);

  const [activeMode, setActiveMode] = useState<"quick" | "book" | "duels">(
    "quick",
  );
  const [showMobileTrade, setShowMobileTrade] = useState(false);

  // Load claimable position for this market if resolved
  useEffect(() => {
    if (market.status === "RESOLVED" && market.result) {
      fetchPositions().then((positions) => {
        const winPos = positions.find(
          (p: any) =>
            p.marketId === market.id &&
            !p.claimed &&
            (p.position === market.result ||
              (market.result === "YES" && p.position === "A") ||
              (market.result === "NO" && p.position === "B")),
        );
        setClaimablePosId(winPos?.id ?? null);
      });
    }
  }, [market.id, market.status, market.result, fetchPositions]);

  useEffect(() => {
    if (activeMode === "duels") {
      const loadDuels = async () => {
        const duels = await fetchDuels();
        setMarketDuels(duels.filter((d) => d.parentMarketId === market.id));
      };
      loadDuels();
    }
  }, [fetchDuels, activeMode, market.id]);

  const handleQuickBet = async () => {
    if (readOnly) {
      onAuthRequired?.(t("marketDetail.actionBuyMarket", "buy or sell in markets"));
      return;
    }
    setIsPending(true);
    try {
      await executeTransaction(
        async () => {
          await executeTrade(
            market.id,
            parseFloat(betAmount) || 0,
            selectedSide,
            "swap",
          );
          return `trade-${market.id}-${Date.now()}`;
        },
        {
          pendingMessage: t("marketDetail.tradePending", "Placing {{amount}} {{currency}} on {{side}}...", {
            amount: betAmount,
            currency: market.currency,
            side: selectedSide,
          }),
          successMessage: t("marketDetail.tradeSuccess", "Trade executed successfully!"),
          errorMessage: t("marketDetail.tradeFailed", "Trade failed"),
          explorerUrl: () => "https://explorer.solana.com?cluster=devnet",
        },
      );
    } catch (err: any) {
      console.error("Quick bet failed", err);
      addToast({
        type: "error",
        message: err?.message || t("marketDetail.tradeFailed", "Trade failed"),
      });
    } finally {
      setIsPending(false);
    }
  };

  const { setVisible } = useWalletModal();

  const handleClaim = async () => {
    if (readOnly) {
      onAuthRequired?.(t("marketDetail.actionClaimPayout", "claim payout"));
      return;
    }
    if (!claimablePosId) return;
    setIsClaiming(true);
    try {
      await executeTransaction(
        async () => {
          const result = await claimPosition(claimablePosId);
          if (result) {
            setClaimResult(result);
            setClaimablePosId(null);
          }
          return `claim-${claimablePosId}-${Date.now()}`;
        },
        {
          pendingMessage: t("marketDetail.claimPending", "Claiming payout..."),
          successMessage: t("marketDetail.claimSuccess", "Position claimed successfully!"),
          errorMessage: t("marketDetail.claimFailed", "Failed to claim position"),
          explorerUrl: () => "https://explorer.solana.com?cluster=devnet",
        },
      );
    } catch (err: any) {
      console.error("Claim failed", err);
      addToast({
        type: "error",
        message: err?.message || t("marketDetail.claimFailed", "Failed to claim position"),
      });
    } finally {
      setIsClaiming(false);
    }
  };

  const handleHostDuel = () => {
    if (readOnly) {
      onAuthRequired?.(t("marketDetail.actionHostDuel", "host a duel"));
      return;
    }
    onHostDuel?.();
  };

  const isLynx = market.currency === "LYNX";

  // --- Dynamic Parimutuel Pricing ---
  const currentYesAmount = market.yesAmount || 0;
  const currentNoAmount = market.noAmount || 0;
  const currentDrawAmount = market.drawAmount || 0;
  const totalPool = currentYesAmount + currentNoAmount + currentDrawAmount;

  const yesRatio =
    totalPool > 0
      ? (currentYesAmount / totalPool) * 100
      : market.isTernary
        ? 33.3
        : 50;
  const noRatio =
    totalPool > 0
      ? (currentNoAmount / totalPool) * 100
      : market.isTernary
        ? 33.3
        : 50;
  const drawRatio =
    totalPool > 0
      ? (currentDrawAmount / totalPool) * 100
      : market.isTernary
        ? 33.3
        : 0;

  const parsedAmount = parseFloat(betAmount) || 0;
  const isYes = selectedSide === Position.YES;
  const isNo = selectedSide === Position.NO;
  const isDraw = selectedSide === Position.DRAW;

  const currentSidePool = isYes
    ? currentYesAmount
    : isNo
      ? currentNoAmount
      : currentDrawAmount;
  const oppositeSidePool = totalPool - currentSidePool;

  const newSidePool = currentSidePool + parsedAmount;
  const shareOfPool = newSidePool > 0 ? parsedAmount / newSidePool : 0;

  const PROTOCOL_FEE = 0.1; // 10% fee on winnings
  const netOppositePool = oppositeSidePool * (1 - PROTOCOL_FEE);
  const estimatedReward = shareOfPool * netOppositePool;
  const totalPayout = parsedAmount + estimatedReward;

  const lynxDrop = parsedAmount * 0.3;
  // ----------------------------------

  return (
    <div className="fixed inset-0 z-[100] flex items-end md:items-center justify-center p-0 md:p-4">
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="absolute inset-0 bg-[#0A0A0B]/90 backdrop-blur-sm"
        onClick={onClose}
      />

      <motion.div
        initial={{ opacity: 0, y: 100 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: 100 }}
        className="relative w-full max-w-6xl bg-[#0A0A0B] border-t-0 md:border border-[#1F1F23] md:rounded-xl overflow-hidden shadow-2xl flex flex-col md:flex-row h-[100dvh] md:h-[95vh] md:max-h-[90vh]"
      >
        {/* Left Side: Market Info & Dynamic Content */}
        <div className="flex-1 p-5 md:p-10 flex flex-col bg-[#0D0D0E]/50 overflow-y-auto custom-scrollbar">
          <div className="mb-6 md:mb-8">
            <div className="flex items-center gap-3 mb-2">
              <span
                className={cn(
                  "text-[8px] md:text-[9px] px-2 py-0.5 rounded border tracking-[0.2em] uppercase font-bold",
                  isLynx
                    ? "bg-[#9945FF]/10 text-[#9945FF] border-[#9945FF]/20"
                    : "bg-[#18181B] text-[#A1A1AA] border-[#27272A]",
                )}
              >
                {market.category} Market #{market.id}{" "}
                {isLynx && `- ${t("marketDetail.special", "SPECIAL")}`}
              </span>
              <span className="text-[8px] md:text-[9px] text-[#52525B] font-mono font-bold">
                {t("marketDetail.oracle", "ORACLE: SWITCHBOARD")}
              </span>
            </div>
            <h1 className="text-lg md:text-4xl font-bold tracking-tight text-white mb-4 leading-tight">
              {market.title}
            </h1>

            <div className="w-full h-32 md:h-48 rounded-xl overflow-hidden mb-6 relative border border-[#27272A] bg-[#0A0A0B] p-2">
              <MiniMarketChart isLynx={isLynx} market={market} />
              <div className="absolute inset-0 bg-gradient-to-t from-[#0D0D0E]/50 via-transparent to-transparent pointer-events-none" />
            </div>
          </div>

          <AnimatePresence mode="wait">
            {activeMode === "quick" && (
              <motion.div
                key="quick-view"
                initial={{ opacity: 0, x: -20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: 20 }}
                className="space-y-6 md:space-y-8"
              >
                <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 md:gap-4">
                  {[
                    {
                      label: t("marketDetail.ratio", "Ratio"),
                      value: market.isTernary ? (
                        <span className="flex items-center gap-1">
                          <span
                            className={
                              isLynx ? "text-[#9945FF]" : "text-[#00FFD1]"
                            }
                          >
                            {yesRatio.toFixed(0)}% A
                          </span>
                          <span className="text-[#52525B]">/</span>
                          <span className="text-red-400">
                            {noRatio.toFixed(0)}% B
                          </span>
                          <span className="text-[#52525B]">/</span>
                          <span className="text-blue-400">
                            {drawRatio.toFixed(0)}% D
                          </span>
                        </span>
                      ) : (
                        <span className="flex items-center gap-1">
                          <span
                            className={
                              isLynx ? "text-[#9945FF]" : "text-[#00FFD1]"
                            }
                          >
                            {yesRatio.toFixed(0)}% Y
                          </span>
                          <span className="text-[#52525B]">/</span>
                          <span className="text-red-400">
                            {noRatio.toFixed(0)}% N
                          </span>
                        </span>
                      ),
                      color: "",
                    },
                    {
                      label: t("marketDetail.asset", "Asset"),
                      value: market.currency,
                      color: "text-white",
                    },
                    {
                      label: isLynx
                        ? t("marketDetail.deflation", "Deflation")
                        : t("marketDetail.lynxYield", "$LYNX Yield"),
                      value: isLynx ? "15% Burn" : "+30% Pool",
                      color: isLynx ? "text-red-400" : "text-[#9945FF]",
                    },
                    {
                      label: t("marketDetail.status", "Status"),
                      value: t("marketDetail.preEvent", "PRE-EVENT"),
                      color: "text-amber-400",
                    },
                  ].map((stat, i) => (
                    <div
                      key={i}
                      className="p-3 md:p-4 bg-[#141417] border border-[#27272A] rounded"
                    >
                      <span className="text-[8px] md:text-[9px] text-[#71717A] block uppercase font-bold mb-1">
                        {stat.label}
                      </span>
                      <span
                        className={`text-[11px] md:text-sm font-mono font-bold ${stat.color}`}
                      >
                        {stat.value}
                      </span>
                    </div>
                  ))}
                </div>

                <div className="flex-1 flex flex-col items-center justify-center border border-dashed border-[#27272A] rounded-xl relative overflow-hidden bg-[#0D0D0E] min-h-[250px] md:min-h-[300px] p-6">
                  <div
                    className={cn(
                      "absolute inset-0 opacity-10",
                      isLynx
                        ? "bg-[radial-gradient(circle_at_50%_50%,_#9945FF_0%,_transparent_70%)]"
                        : "bg-[radial-gradient(circle_at_50%_50%,_#00FFD1_0%,_transparent_70%)]",
                    )}
                  ></div>
                  <div className="z-10 flex flex-col items-center text-center w-full max-w-xs">
                    <span className="text-[9px] md:text-[10px] text-[#52525B] uppercase font-bold tracking-widest mb-4">
                      {t("marketDetail.probability", "Probability")}
                    </span>
                    <span className="text-4xl md:text-6xl font-mono font-bold text-white mb-2 tracking-tighter">
                      {(yesRatio / 100).toFixed(3)}
                    </span>
                    <div className="flex gap-2 mt-4 md:mt-6 w-full">
                      {market.isTernary ? (
                        <div className="w-full h-1.5 md:h-2 bg-[#27272A] rounded-full overflow-hidden flex">
                          <div
                            className={cn(
                              "h-full transition-all duration-1000",
                              isLynx
                                ? "bg-[#9945FF]"
                                : "bg-gradient-to-r from-[#00FFD1] to-[#9945FF]",
                            )}
                            style={{ width: `${yesRatio}%` }}
                          ></div>
                          <div
                            className="h-full transition-all duration-1000 bg-red-400"
                            style={{ width: `${noRatio}%` }}
                          ></div>
                          <div
                            className="h-full transition-all duration-1000 bg-blue-400"
                            style={{ width: `${drawRatio}%` }}
                          ></div>
                        </div>
                      ) : (
                        <div className="w-full h-1.5 md:h-2 bg-[#27272A] rounded-full overflow-hidden flex">
                          <div
                            className={cn(
                              "h-full transition-all duration-1000",
                              isLynx
                                ? "bg-[#9945FF]"
                                : "bg-gradient-to-r from-[#00FFD1] to-[#9945FF]",
                            )}
                            style={{ width: `${yesRatio}%` }}
                          ></div>
                        </div>
                      )}
                    </div>
                    <div className="flex justify-between w-full mt-2 text-[8px] md:text-[10px] font-black uppercase">
                      {market.isTernary ? (
                        <>
                          <span
                            className={cn(
                              isLynx ? "text-[#9945FF]" : "text-[#00FFD1]",
                            )}
                          >
                            {yesRatio.toFixed(0)}% OPT A
                          </span>
                          <span className="text-red-400">
                            {noRatio.toFixed(0)}% OPT B
                          </span>
                          <span className="text-blue-400">
                            {drawRatio.toFixed(0)}% DRAW
                          </span>
                        </>
                      ) : (
                        <>
                          <span
                            className={cn(
                              isLynx ? "text-[#9945FF]" : "text-[#00FFD1]",
                            )}
                          >
                            {yesRatio.toFixed(0)}% YES
                          </span>
                          <span className="text-red-400">
                            {noRatio.toFixed(0)}% NO
                          </span>
                        </>
                      )}
                    </div>
                  </div>
                </div>
              </motion.div>
            )}

            {activeMode === "book" && (
              <motion.div
                key="book-view"
                initial={{ opacity: 0, x: -20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: 20 }}
                className="space-y-4 md:space-y-6"
              >
                <div className="grid grid-cols-2 gap-4 md:gap-8">
                  <div>
                    <h4 className="text-[8px] md:text-[10px] font-bold text-[#00FFD1] uppercase tracking-widest mb-3 md:mb-4">
                      {t("marketDetail.buyOrders", "Buy Orders")}
                    </h4>
                    <div className="space-y-1 font-mono text-[10px] md:text-[11px]">
                      {[0.645, 0.64, 0.635, 0.63, 0.625].map((p, i) => (
                        <div
                          key={i}
                          className="flex justify-between p-1.5 md:p-2 hover:bg-white/5 rounded transition-colors group"
                        >
                          <span className="text-[#00FFD1]">{p.toFixed(3)}</span>
                          <span className="text-[#52525B] group-hover:text-white">
                            12.5
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                  <div>
                    <h4 className="text-[8px] md:text-[10px] font-bold text-red-400 uppercase tracking-widest mb-3 md:mb-4">
                      {t("marketDetail.sellOrders", "Sell Orders")}
                    </h4>
                    <div className="space-y-1 font-mono text-[10px] md:text-[11px]">
                      {[0.615, 0.61, 0.605, 0.6, 0.595].map((p, i) => (
                        <div
                          key={i}
                          className="flex justify-between p-1.5 md:p-2 hover:bg-white/5 rounded transition-colors group"
                        >
                          <span className="text-red-400">{p.toFixed(3)}</span>
                          <span className="text-[#52525B] group-hover:text-white">
                            8.2
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
                <div className="p-6 md:p-8 border border-dashed border-[#27272A] rounded-xl flex flex-col items-center justify-center text-center bg-[#0A0A0B]">
                  <BarChart3
                    className={cn(
                      "w-8 h-8 md:w-12 md:h-12 mb-3 md:mb-4 opacity-20",
                      isLynx ? "text-[#9945FF]" : "text-[#00FFD1]",
                    )}
                  />
                  <p className="text-[8px] md:text-[10px] font-bold text-[#52525B] uppercase tracking-widest mb-4">
                    {t(
                      "marketDetail.connectToTrade",
                      "Connect wallet to trade",
                    )}
                  </p>
                  <button
                    type="button"
                    onClick={() => setVisible(true)}
                    className="inline-flex items-center gap-2 px-4 py-2 bg-[#00FFD1] text-black text-xs font-bold uppercase rounded hover:bg-[#00E5BC] transition-colors"
                  >
                    <Wallet className="w-4 h-4" />
                    {t("marketDetail.connectWallet", "Connect Wallet")}
                  </button>
                </div>
              </motion.div>
            )}

            {activeMode === "duels" && (
              <motion.div
                key="duels-view"
                initial={{ opacity: 0, x: -20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: 20 }}
                className="space-y-6"
              >
                <div className="flex items-center justify-between">
                  <h4 className="text-[10px] font-bold text-white uppercase tracking-widest">
                    {t(
                      "marketDetail.openChallenges",
                      "Open Challenges ({{count}})",
                      { count: marketDuels.length },
                    )}
                  </h4>
                  <button
                    type="button"
                    onClick={handleHostDuel}
                    className={cn(
                      "px-4 py-1.5 rounded text-[10px] font-bold uppercase tracking-widest border transition-all",
                      isLynx
                        ? "border-[#9945FF]/30 text-[#9945FF] hover:bg-[#9945FF]/10"
                        : "border-[#00FFD1]/30 text-[#00FFD1] hover:bg-[#00FFD1]/10",
                    )}
                  >
                    {t("marketDetail.hostNewDuel", "Host New Duel")}
                  </button>
                </div>

                <div className="grid grid-cols-1 gap-3">
                  {marketDuels.length > 0 ? (
                    marketDuels.map((duel) => (
                      <div
                        key={duel.id}
                        className={cn(
                          "p-4 rounded border flex items-center justify-between group hover:scale-[1.01] transition-all cursor-pointer",
                          isLynx
                            ? "bg-[#9945FF]/5 border-[#9945FF]/20"
                            : "bg-[#18181B] border-[#27272A]",
                        )}
                      >
                        <div className="flex items-center gap-4">
                          <div
                            className={cn(
                              "w-10 h-10 rounded flex items-center justify-center border",
                              isLynx
                                ? "bg-[#9945FF]/10 border-[#9945FF]/20 text-[#9945FF]"
                                : "bg-[#18181B] border-[#27272A] text-white",
                            )}
                          >
                            <Sword className="w-5 h-5" />
                          </div>
                          <div>
                            <div className="text-[10px] text-[#52525B] font-bold uppercase mb-0.5">
                              {t(
                                "marketDetail.creator",
                                "Creator: {{creator}}",
                                { creator: duel.creator },
                              )}
                            </div>
                            <div className="text-sm font-bold text-white uppercase italic tracking-tighter">
                              {t("marketDetail.versus", "VERSUS {{position}}", {
                                position: duel.positionA,
                              })}
                            </div>
                          </div>
                        </div>
                        <div className="text-right">
                          <div className="text-[10px] text-[#52525B] font-bold uppercase mb-0.5">
                            {t("marketDetail.stakeStandalone", "Stake")}
                          </div>
                          <div
                            className={cn(
                              "font-mono font-bold",
                              isLynx ? "text-[#9945FF]" : "text-[#00FFD1]",
                            )}
                          >
                            {duel.amount} {market.currency}
                          </div>
                        </div>
                      </div>
                    ))
                  ) : (
                    <div className="p-20 border border-dashed border-[#27272A] rounded-xl text-center">
                      <p className="text-[10px] font-bold text-[#52525B] uppercase tracking-widest">
                        {t(
                          "marketDetail.noActiveDuels",
                          "No active duels for this event.",
                        )}
                      </p>
                      <p className="text-[9px] text-[#52525B] uppercase mt-2">
                        {t(
                          "marketDetail.beTheFirst",
                          "Be the first to host one!",
                        )}
                      </p>
                    </div>
                  )}
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* Mobile Trade Trigger & Close */}
        {!showMobileTrade && (
          <div className="md:hidden p-4 bg-[#0A0A0B] border-t border-[#1F1F23] shrink-0 flex flex-col gap-2">
            <button
              onClick={() => setShowMobileTrade(true)}
              className={cn(
                "w-full text-black font-black py-4 rounded uppercase tracking-tighter text-sm transition-all flex items-center justify-center gap-2",
                isLynx
                  ? "bg-[#9945FF]"
                  : "bg-gradient-to-r from-[#00FFD1] to-[#9945FF]",
              )}
            >
              {t("marketDetail.tradeNow", "Trade")}
            </button>
            <button
              onClick={onClose}
              className="w-full py-4 text-[10px] font-bold text-[#52525B] uppercase tracking-[0.3em] hover:text-white transition-colors"
            >
              {t("marketDetail.discardAndReturn", "Discard & Return")}
            </button>
          </div>
        )}

        {/* Right Side: Execution Panel */}
        <aside
          className={cn(
            "w-full md:w-[360px] lg:w-[400px] bg-[#0D0D0E] border-t md:border-t-0 md:border-l border-[#1F1F23] flex-col shrink-0 overflow-y-auto custom-scrollbar md:flex transition-all",
            showMobileTrade ? "flex h-[65dvh] md:h-auto" : "hidden",
          )}
        >
          {/* Mobile Header with Hide button */}
          <div className="md:hidden p-4 border-b border-[#1F1F23] flex items-center justify-between bg-[#0A0A0B] shrink-0 sticky top-0 z-10">
            <span className="text-[10px] font-bold text-white uppercase tracking-widest">
              {t("marketDetail.trade", "Trade")}
            </span>
            <button
              onClick={() => setShowMobileTrade(false)}
              className="text-[#A1A1AA] flex items-center gap-2 font-mono text-[10px] uppercase font-bold px-2 py-1 bg-[#141417] rounded border border-[#27272A]"
            >
              <ArrowRight className="w-3 h-3 rotate-90" />{" "}
              {t("marketDetail.hide", "Hide")}
            </button>
          </div>

          <div className="p-4 md:p-6 border-b border-[#1F1F23]">
            <h3 className="hidden md:block text-[10px] md:text-[11px] font-bold text-[#71717A] uppercase tracking-widest mb-4 md:mb-6">
              {t("marketDetail.marketAccess", "Market Access")}
            </h3>

            <div className="flex gap-1 bg-[#18181B] p-0.5 rounded mb-4 md:mb-6 border border-[#27272A]">
              <button
                onClick={() => setActiveMode("quick")}
                className={cn(
                  "flex-1 py-1.5 md:py-3 text-[8px] md:text-[10px] font-bold rounded uppercase tracking-widest transition-all",
                  activeMode === "quick"
                    ? isLynx
                      ? "bg-[#9945FF] text-white"
                      : "bg-[#0A0A0B] text-[#00FFD1]"
                    : "text-[#52525B] hover:text-white",
                )}
              >
                {t("marketDetail.quick", "Quick")}
              </button>
              <button
                onClick={() => setActiveMode("book")}
                className={cn(
                  "flex-1 py-1.5 md:py-3 text-[8px] md:text-[10px] font-bold rounded uppercase tracking-widest transition-all",
                  activeMode === "book"
                    ? isLynx
                      ? "bg-[#9945FF] text-white"
                      : "bg-[#0A0A0B] text-[#00FFD1]"
                    : "text-[#52525B] hover:text-white",
                )}
              >
                {t("marketDetail.book", "Book")}
              </button>
              <button
                onClick={() => setActiveMode("duels")}
                className={cn(
                  "flex-1 py-1.5 md:py-3 text-[8px] md:text-[10px] font-bold rounded uppercase tracking-widest transition-all",
                  activeMode === "duels"
                    ? isLynx
                      ? "bg-[#9945FF] text-white"
                      : "bg-[#0A0A0B] text-[#00FFD1]"
                    : "text-[#52525B] hover:text-white",
                )}
              >
                {t("marketDetail.duels", "Duels")}
              </button>
            </div>

            <AnimatePresence mode="wait">
              {activeMode === "quick" ? (
                <motion.div
                  key="action-quick"
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -10 }}
                  className="space-y-4 md:space-y-6"
                >
                  <div>
                    <div className="flex gap-2">
                      {market.isTernary ? (
                        <>
                          <button
                            onClick={() => setSelectedSide(Position.YES)}
                            className={cn(
                              "flex-1 py-2 md:py-4 rounded border transition-all font-black text-[10px] md:text-sm",
                              selectedSide === Position.YES
                                ? isLynx
                                  ? "bg-[#9945FF]/10 border-[#9945FF] text-[#9945FF]"
                                  : "bg-[#00FFD1]/5 border-[#00FFD1] text-[#00FFD1]"
                                : "bg-[#18181B] border-[#27272A] text-[#52525B]",
                            )}
                          >
                            {t("marketDetail.optA", "OPT A")}
                          </button>
                          <button
                            onClick={() => setSelectedSide(Position.NO)}
                            className={cn(
                              "flex-1 py-2 md:py-4 rounded border transition-all font-black text-[10px] md:text-sm",
                              selectedSide === Position.NO
                                ? "bg-red-400/10 border-red-400 text-red-400"
                                : "bg-[#18181B] border-red-900/20 text-red-400/40 hover:text-red-400 hover:border-red-400/40",
                            )}
                          >
                            {t("marketDetail.optB", "OPT B")}
                          </button>
                          <button
                            onClick={() => setSelectedSide(Position.DRAW)}
                            className={cn(
                              "flex-1 py-2 md:py-4 rounded border transition-all font-black text-[10px] md:text-sm",
                              selectedSide === Position.DRAW
                                ? "bg-blue-400/10 border-blue-400 text-blue-400"
                                : "bg-[#18181B] border-blue-900/20 text-blue-400/40 hover:text-blue-400 hover:border-blue-400/40",
                            )}
                          >
                            {t("marketDetail.draw", "DRAW")}
                          </button>
                        </>
                      ) : (
                        <>
                          <button
                            onClick={() => setSelectedSide(Position.YES)}
                            className={cn(
                              "flex-1 py-2 md:py-4 rounded border transition-all font-black text-[10px] md:text-sm",
                              selectedSide === Position.YES
                                ? isLynx
                                  ? "bg-[#9945FF]/10 border-[#9945FF] text-[#9945FF]"
                                  : "bg-[#00FFD1]/5 border-[#00FFD1] text-[#00FFD1]"
                                : "bg-[#18181B] border-[#27272A] text-[#52525B]",
                            )}
                          >
                            {t("marketDetail.yes", "YES")}
                          </button>
                          <button
                            onClick={() => setSelectedSide(Position.NO)}
                            className={cn(
                              "flex-1 py-2 md:py-4 rounded border transition-all font-black text-[10px] md:text-sm",
                              selectedSide === Position.NO
                                ? "bg-red-400/10 border-red-400 text-red-400"
                                : "bg-[#18181B] border-red-900/20 text-red-400/40 hover:text-red-400 hover:border-red-400/40",
                            )}
                          >
                            {t("marketDetail.no", "NO")}
                          </button>
                        </>
                      )}
                    </div>
                  </div>

                  <div>
                    <div className="flex justify-between items-center mb-1.5 md:mb-2">
                      <label className="text-[8px] md:text-[10px] text-[#71717A] uppercase font-bold tracking-wider">
                        {t("marketDetail.stake", "Stake ({{currency}})", {
                          currency: market.currency,
                        })}
                      </label>
                      <span
                        className={cn(
                          "text-[8px] md:text-[10px] font-mono font-bold",
                          isLynx ? "text-[#9945FF]" : "text-[#00FFD1]",
                        )}
                      >
                        {t("marketDetail.max", "MAX: {{max}}", {
                          max: isLynx ? "5K" : "42",
                        })}
                      </span>
                    </div>
                    <div className="relative group">
                      <input
                        type="number"
                        className="w-full bg-[#18181B] border border-[#27272A] rounded p-2.5 md:p-4 text-lg md:text-2xl font-mono text-white outline-none focus:border-[#00FFD1] tracking-tighter"
                        value={betAmount}
                        onChange={(e) => setBetAmount(e.target.value)}
                      />
                      <button
                        className="absolute right-1.5 md:right-2 top-1.5 md:top-2 bottom-1.5 md:bottom-2 px-2.5 md:px-3 bg-[#27272A] text-[8px] md:text-[10px] font-black text-[#A1A1AA] hover:text-[#00FFD1] hover:bg-[#2D2D33] uppercase rounded transition-all z-10"
                        onClick={() => setBetAmount(isLynx ? "5000" : "42")}
                      >
                        Max
                      </button>
                    </div>
                  </div>

                  <div className="bg-[#18181B] p-3 md:p-5 rounded border border-[#27272A] space-y-2 md:space-y-4">
                    {!isLynx && (
                      <div className="flex justify-between items-center bg-[#9945FF]/10 border border-[#9945FF]/20 px-3 py-2 rounded">
                        <span className="text-[#9945FF] uppercase tracking-widest text-[9px] md:text-[11px] font-bold flex items-center gap-2">
                          {t("marketDetail.lynxDrop", "$LYNX Drop")}
                        </span>
                        <div className="flex flex-col items-end">
                          <span className="font-mono text-[#9945FF] font-bold text-sm">
                            +{lynxDrop.toFixed(2)}
                          </span>
                          <span className="text-[6px] md:text-[7px] text-[#9945FF]/70 uppercase tracking-widest">
                            30% User Emission Share
                          </span>
                        </div>
                      </div>
                    )}
                    <div className="flex justify-between text-[9px] md:text-[11px] font-medium items-center">
                      <span className="text-[#52525B] uppercase tracking-widest">
                        {t("marketDetail.estPayout", "Est. Payout")}
                      </span>
                      <div className="flex flex-col items-end gap-1">
                        <span
                          className={cn(
                            "font-mono font-bold text-base md:text-lg leading-none",
                            isLynx ? "text-[#9945FF]" : "text-[#00FFD1]",
                          )}
                        >
                          {totalPayout.toFixed(2)} {market.currency}
                        </span>
                        <span className="text-[7px] md:text-[8px] text-[#A1A1AA] uppercase tracking-widest">
                          {t(
                            "marketDetail.includesPrincipal",
                            "(Includes Principal)",
                          )}
                        </span>
                      </div>
                    </div>
                  </div>

                  <button
                    onClick={handleQuickBet}
                    disabled={isPending || market.status === "RESOLVED"}
                    className={cn(
                      "w-full text-black font-black py-3 md:py-4 rounded uppercase tracking-tighter text-[10px] md:text-sm transition-all hover:scale-[1.02] active:scale-95 disabled:opacity-50 disabled:scale-100 flex items-center justify-center gap-2 md:gap-3",
                      isLynx
                        ? "bg-[#9945FF] shadow-[0_0_20px_rgba(153,69,255,0.3)]"
                        : "bg-gradient-to-r from-[#00FFD1] to-[#9945FF] shadow-[0_0_20px_rgba(0,255,209,0.3)]",
                    )}
                  >
                    {isPending ? (
                      <>
                        <div className="w-3 h-3 md:w-4 md:h-4 border-2 border-black border-t-transparent rounded-full animate-spin" />
                        {t("marketDetail.processing", "Processing...")}
                      </>
                    ) : (
                      t("marketDetail.confirmTrade", "Confirm Trade")
                    )}
                  </button>

                  {/* Claim payout banner for resolved markets */}
                  {market.status === "RESOLVED" && (
                    <div className="mt-3 p-4 bg-[#00FFD1]/5 border border-[#00FFD1]/20 rounded-xl">
                      {claimResult ? (
                        <div className="text-center">
                          <div className="text-[#00FFD1] font-black text-lg mb-1">
                            {t("marketDetail.claimed", "Claimed!")}
                          </div>
                          <div className="text-white text-sm font-bold">
                            {t(
                              "marketDetail.claimAddedToBalance",
                              "{{amount}} {{currency}} added to your balance",
                              {
                                amount: claimResult.payout,
                                currency: claimResult.currency,
                              },
                            )}
                          </div>
                        </div>
                      ) : claimablePosId ? (
                        <>
                          <p className="text-[10px] text-[#00FFD1] uppercase font-black tracking-widest mb-3 text-center">
                            {t("marketDetail.youWonMarket", "You won this market!")}
                          </p>
                          <button
                            onClick={handleClaim}
                            disabled={isClaiming}
                            className="w-full py-3 bg-[#00FFD1] text-black font-black text-[10px] uppercase tracking-widest rounded flex items-center justify-center gap-2 hover:bg-[#00E5BC] transition-all disabled:opacity-60"
                          >
                            {isClaiming ? (
                              <>
                                <div className="w-3 h-3 border-2 border-black border-t-transparent rounded-full animate-spin" />{" "}
                                {t("marketDetail.claiming", "Claiming...")}
                              </>
                            ) : (
                              t("marketDetail.claimPayout", "Claim Payout")
                            )}
                          </button>
                        </>
                      ) : (
                        <p className="text-[10px] text-[#52525B] uppercase font-bold tracking-widest text-center">
                          {t("marketDetail.marketResolvedWon", "Market resolved - {{result}} won", {
                            result: market.result,
                          })}
                        </p>
                      )}
                    </div>
                  )}
                </motion.div>
              ) : (
                <motion.div
                  key="action-info"
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -10 }}
                  className="p-6 bg-[#18181B]/50 border border-[#27272A] rounded-xl text-center"
                >
                  <div
                    className={cn(
                      "w-12 h-12 mx-auto rounded-full flex items-center justify-center mb-4",
                      isLynx
                        ? "bg-[#9945FF]/10 text-[#9945FF]"
                        : "bg-[#00FFD1]/10 text-[#00FFD1]",
                    )}
                  >
                    <Zap className="w-5 h-5" />
                  </div>
                  <h4 className="text-[11px] font-black text-white uppercase tracking-widest mb-2">
                    {t("marketDetail.professionalMode", "Professional Mode")}
                  </h4>
                  <p className="text-[10px] text-[#71717A] leading-relaxed uppercase font-bold">
                    {activeMode === "book"
                      ? t(
                          "marketDetail.bookInfo",
                          "Select a price point on the left to pre-fill an order. Direct P2P matching with zero spread.",
                        )
                      : t(
                          "marketDetail.duelsInfo",
                          "Browse direct challenges for this event. These are fixed-odds duels with pre-defined stakes.",
                        )}
                  </p>
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          <div className="p-6 mt-auto">
            <button
              onClick={onClose}
              className="w-full text-[10px] font-bold text-[#52525B] uppercase tracking-[0.3em] hover:text-white transition-colors"
            >
              {t("marketDetail.discardAndReturn", "Discard & Return")}
            </button>
          </div>
        </aside>
      </motion.div>
    </div>
  );
}
