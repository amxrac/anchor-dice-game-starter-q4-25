import * as anchor from "@coral-xyz/anchor";
import { Program, web3, BN } from "@coral-xyz/anchor";
import { AnchorDiceGameQ425 } from "../target/types/anchor_dice_game_q4_25";
import { randomBytes } from "crypto";

const {
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  Ed25519Program,
  SYSVAR_INSTRUCTIONS_PUBKEY,
  sendAndConfirmTransaction,
  LAMPORTS_PER_SOL,
} = web3;

describe("anchor-dice-game-q4-25", () => {
  anchor.setProvider(anchor.AnchorProvider.env());
  const program = anchor.workspace
    .anchorDiceGameQ425 as Program<AnchorDiceGameQ425>;

  const house = Keypair.generate();
  const player = Keypair.generate();
  const seed = new BN(randomBytes(16));
  const vault = PublicKey.findProgramAddressSync(
    [Buffer.from("vault"), house.publicKey.toBuffer()],
    program.programId,
  )[0];
  const bet = PublicKey.findProgramAddressSync(
    [Buffer.from("bet"), vault.toBuffer(), seed.toBuffer("le", 16)],
    program.programId,
  )[0];

  it("Airdrop", async () => {
    await Promise.all(
      [house, player].map(async (k) =>
        confirmTx(
          await anchor
            .getProvider()
            .connection.requestAirdrop(k.publicKey, 1000 * LAMPORTS_PER_SOL),
        ),
      ),
    );
  });

  it("Initialize", async () => {
    await confirmTx(
      await program.methods
        .initialize(new BN(LAMPORTS_PER_SOL).mul(new BN(100)))
        .accountsStrict({
          house: house.publicKey,
          vault,
          systemProgram: SystemProgram.programId,
        })
        .signers([house])
        .rpc(),
    );
  });

  it("Place a bet", async () => {
    await confirmTx(
      await program.methods
        .placeBet(seed, 50, new BN(LAMPORTS_PER_SOL / 100))
        .accountsStrict({
          player: player.publicKey,
          house: house.publicKey,
          vault,
          bet,
          systemProgram: SystemProgram.programId,
        })
        .signers([player])
        .rpc(),
    );
  });

  it("Resolve a bet", async () => {
    const account = await anchor
      .getProvider()
      .connection.getAccountInfo(bet, "confirmed");
    const sig_ix = Ed25519Program.createInstructionWithPrivateKey({
      privateKey: house.secretKey,
      message: account.data.subarray(8),
    });

    const resolve_ix = await program.methods
      .resolveBet(Buffer.from(sig_ix.data.buffer.slice(16 + 32, 16 + 32 + 64)))
      .accountsStrict({
        player: player.publicKey,
        house: house.publicKey,
        vault,
        bet,
        instructionSysvar: SYSVAR_INSTRUCTIONS_PUBKEY,
        systemProgram: SystemProgram.programId,
      })
      .instruction();

    const tx = new Transaction().add(sig_ix).add(resolve_ix);
    await sendAndConfirmTransaction(program.provider.connection, tx, [house]);
  });
});

const confirmTx = async (signature: string): Promise<string> => {
  const latestBlockhash = await anchor
    .getProvider()
    .connection.getLatestBlockhash();
  await anchor
    .getProvider()
    .connection.confirmTransaction(
      { signature, ...latestBlockhash },
      "confirmed",
    );
  return signature;
};
