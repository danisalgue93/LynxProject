import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const now = Date.now();
  const cutoff = new Date(now + 1000 * 60 * 60 * 24);
  const resolveAt = new Date(now + 1000 * 60 * 60 * 30);
  const oracleDeadline = new Date(resolveAt.getTime() + 1000 * 60 * 60);

  await prisma.market.upsert({
    where: { id: 'market-sol-btc-100k' },
    update: { title: 'Will BTC close above 100k this month?', description: 'Binary SOL prediction market resolved by oracle, with manual admin fallback after 1 hour.', category: 'Crypto', status: 'OPEN', currency: 'SOL', oracleId: 'switchboard:btc-month-close' },
    create: {
      id: 'market-sol-btc-100k',
      title: 'Will BTC close above 100k this month?',
      description: 'Binary SOL prediction market resolved by oracle, with manual admin fallback after 1 hour.',
      category: 'Crypto',
      status: 'OPEN',
      currency: 'SOL',
      oracleId: 'switchboard:btc-month-close',
      cutoffAt: cutoff,
      resolveAt,
      oracleDeadline
    }
  });
  console.log(`[seed] market-sol-btc-100k: ${await prisma.market.count({ where: { id: 'market-sol-btc-100k' } }) > 0 ? 'updated' : 'created'}`);

  await prisma.market.upsert({
    where: { id: 'market-lynx-special' },
    update: { title: 'Will LYNX weekly volume exceed 10k SOL?', description: 'Special LYNX-denominated market. 15% of LYNX staked in this market is burned.', category: 'Lynx', status: 'OPEN', currency: 'LYNX', oracleId: 'switchboard:lynx-weekly-volume' },
    create: {
      id: 'market-lynx-special',
      title: 'Will LYNX weekly volume exceed 10k SOL?',
      description: 'Special LYNX-denominated market. 15% of all LYNX staked here is burned.',
      category: 'Lynx',
      status: 'OPEN',
      currency: 'LYNX',
      oracleId: 'switchboard:lynx-weekly-volume',
      cutoffAt: cutoff,
      resolveAt,
      oracleDeadline
    }
  });
  console.log(`[seed] market-lynx-special: ${await prisma.market.count({ where: { id: 'market-lynx-special' } }) > 0 ? 'updated' : 'created'}`);

  await prisma.market.upsert({
    where: { id: 'market-1v1vp-final' },
    update: { title: 'Champions final: Team A, Team B or draw?', description: 'Ternary SOL market used by 1v1vP duels.', category: 'Sports', status: 'OPEN', currency: 'SOL', isTernary: true, oracleId: 'switchboard:football-final' },
    create: {
      id: 'market-1v1vp-final',
      title: 'Champions final: Team A, Team B or draw?',
      description: 'Ternary SOL market used by 1v1vP duels.',
      category: 'Sports',
      status: 'OPEN',
      currency: 'SOL',
      isTernary: true,
      oracleId: 'switchboard:football-final',
      cutoffAt: cutoff,
      resolveAt,
      oracleDeadline
    }
  });
  console.log(`[seed] market-1v1vp-final: ${await prisma.market.count({ where: { id: 'market-1v1vp-final' } }) > 0 ? 'updated' : 'created'}`);

  await prisma.proposal.upsert({
    where: { id: 'LDAO-1' },
    update: { title: 'Use 20% of treasury fees for first liquidity campaign', description: 'Bootstrap the LYNX/SOL book after the first event closes and LYNX is minted.', votesYes: 0, votesNo: 0, category: 'PROTOCOL' },
    create: {
      id: 'LDAO-1',
      title: 'Use 20% of treasury fees for first liquidity campaign',
      description: 'Bootstrap the LYNX/SOL book after the first event closes and LYNX is minted.',
      status: 'ACTIVE',
      votesYes: 0,
      votesNo: 0,
      endTime: new Date(now + 1000 * 60 * 60 * 24 * 7),
      category: 'PROTOCOL',
      author: 'LYNX Core'
    }
  });
  console.log(`[seed] LDAO-1: ${await prisma.proposal.count({ where: { id: 'LDAO-1' } }) > 0 ? 'updated' : 'created'}`);
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (error) => {
    console.error(error);
    await prisma.$disconnect();
    process.exit(1);
  });
