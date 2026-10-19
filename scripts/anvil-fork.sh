#!/usr/bin/env bash
# Fork Arbitrum One locally with Anvil and fund a test wallet. $0 cost: nothing is deployed on a real network.
#
#   scripts/anvil-fork.sh            start (or reuse) the fork and fund the test account
#   scripts/anvil-fork.sh status     show chain id, block and balances
#   scripts/anvil-fork.sh stop       stop the fork started by this script
#
# Env overrides: FORK_URL, PORT, CHAIN_ID, TEST_ACCOUNT, WEETH_AMOUNT, USDC_AMOUNT, WEETH_ADDRESS, USDC_ADDRESS
set -euo pipefail

export PATH="$PATH:$HOME/.foundry/bin"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PID_FILE="$ROOT/.anvil.pid"
LOG_FILE="$ROOT/.anvil.log"

FORK_URL="${FORK_URL:-https://arb1.arbitrum.io/rpc}"
PORT="${PORT:-8545}"
CHAIN_ID="${CHAIN_ID:-31337}"
RPC="http://127.0.0.1:${PORT}"
TEST_ACCOUNT="${TEST_ACCOUNT:-0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266}"
WEETH_AMOUNT="${WEETH_AMOUNT:-10}"
USDC_AMOUNT="${USDC_AMOUNT:-10000}"
WEETH_ADDRESS="${WEETH_ADDRESS:-0x35751007a407ca6FEFfE80b3cB397736D2cf4dbe}"
USDC_ADDRESS="${USDC_ADDRESS:-0xaf88d065e77c8cC2239327C5EDb3A432268e5831}"

say() { printf '\033[36m[fork]\033[0m %s\n' "$*"; }
warn() { printf '\033[33m[fork] warning:\033[0m %s\n' "$*" >&2; }
die() { printf '\033[31m[fork] error:\033[0m %s\n' "$*" >&2; exit 1; }

require_foundry() {
  if ! command -v anvil >/dev/null 2>&1 || ! command -v cast >/dev/null 2>&1; then
    cat >&2 <<MSG
[fork] Foundry (anvil, cast) is not installed.
  Install:  curl -L https://foundry.paradigm.xyz | bash   &&   foundryup
  Then re-run this script.
MSG
    exit 1
  fi
}

rpc_up() { cast chain-id --rpc-url "$RPC" >/dev/null 2>&1; }

start_fork() {
  if rpc_up; then
    say "an Ethereum node already answers on $RPC (chain id $(cast chain-id --rpc-url "$RPC")); reusing it"
    return
  fi
  say "forking $FORK_URL on $RPC (chain id $CHAIN_ID)"
  nohup anvil --fork-url "$FORK_URL" --chain-id "$CHAIN_ID" --port "$PORT" --host 127.0.0.1 \
    >"$LOG_FILE" 2>&1 &
  echo $! >"$PID_FILE"
  for _ in $(seq 1 90); do
    if rpc_up; then say "anvil is up (pid $(cat "$PID_FILE"), log: $LOG_FILE)"; return; fi
    kill -0 "$(cat "$PID_FILE")" 2>/dev/null || { tail -20 "$LOG_FILE" >&2; die "anvil exited early (is the fork URL reachable?)"; }
    sleep 1
  done
  die "anvil did not become ready within 90s"
}

has_code() { [ "$(cast code "$1" --rpc-url "$RPC" 2>/dev/null)" != "0x" ]; }

# Give $ACCT `amount` whole tokens of an ERC-20 (decimals read from the token).
# 1) anvil_dealERC20 when the node supports it; 2) otherwise brute-force the balances mapping slot.
deal_erc20() {
  local token="$1" acct="$2" amount="$3" label="$4"
  if ! has_code "$token"; then
    warn "$label ($token) has no contract code on this fork, skipping. Check the address with: npm run verify:contracts"
    return 1
  fi
  local dec raw want got
  dec="$(cast call "$token" 'decimals()(uint8)' --rpc-url "$RPC" | awk '{print $1}')"
  raw="$(cast to-unit "${amount}ether" wei >/dev/null 2>&1; python3 -c "print(int(float('$amount') * 10**$dec))")"
  want="$raw"
  if cast rpc anvil_dealERC20 "$acct" "$token" "$(cast to-hex "$raw")" --rpc-url "$RPC" >/dev/null 2>&1; then
    got="$(cast call "$token" 'balanceOf(address)(uint256)' "$acct" --rpc-url "$RPC" | awk '{print $1}')"
    [ "$got" = "$want" ] && { say "dealt $amount $label via anvil_dealERC20"; return 0; }
  fi
  local slot idx
  for slot in 9 51 0 1 2 3 4 5 6 7 8 10 101 151 201; do
    idx="$(cast index address "$acct" "$slot")"
    cast rpc anvil_setStorageAt "$token" "$idx" "$(cast to-uint256 "$raw")" --rpc-url "$RPC" >/dev/null
    got="$(cast call "$token" 'balanceOf(address)(uint256)' "$acct" --rpc-url "$RPC" | awk '{print $1}')"
    if [ "$got" = "$want" ]; then say "dealt $amount $label via storage slot $slot"; return 0; fi
    cast rpc anvil_setStorageAt "$token" "$idx" "$(cast to-uint256 0)" --rpc-url "$RPC" >/dev/null
  done
  warn "could not fund $label: balances slot not found"
  return 1
}

fund_account() {
  say "funding $TEST_ACCOUNT"
  cast rpc anvil_setBalance "$TEST_ACCOUNT" "$(cast to-hex "$(python3 -c 'print(10_000 * 10**18)')")" --rpc-url "$RPC" >/dev/null
  deal_erc20 "$USDC_ADDRESS" "$TEST_ACCOUNT" "$USDC_AMOUNT" USDC || true
  deal_erc20 "$WEETH_ADDRESS" "$TEST_ACCOUNT" "$WEETH_AMOUNT" weETH || true
}

show_status() {
  rpc_up || die "no node on $RPC. Run: scripts/anvil-fork.sh"
  local eth usdc
  eth="$(cast balance "$TEST_ACCOUNT" --rpc-url "$RPC" --ether)"
  say "RPC       $RPC"
  say "chain id  $(cast chain-id --rpc-url "$RPC")   block $(cast block-number --rpc-url "$RPC")"
  say "account   $TEST_ACCOUNT"
  say "ETH       $eth"
  if has_code "$USDC_ADDRESS"; then
    usdc="$(cast call "$USDC_ADDRESS" 'balanceOf(address)(uint256)' "$TEST_ACCOUNT" --rpc-url "$RPC" | awk '{print $1}')"
    say "USDC      $(python3 -c "print($usdc / 10**6)")"
  fi
  if has_code "$WEETH_ADDRESS"; then
    local w; w="$(cast call "$WEETH_ADDRESS" 'balanceOf(address)(uint256)' "$TEST_ACCOUNT" --rpc-url "$RPC" | awk '{print $1}')"
    say "weETH     $(python3 -c "print($w / 10**18)")"
  else
    say "weETH     n/a (no contract code at $WEETH_ADDRESS on this fork)"
  fi
}

case "${1:-start}" in
  start)
    require_foundry
    start_fork
    fund_account
    show_status
    say "ready. Point your wallet at $RPC (chain id $CHAIN_ID) and run: npm run dev"
    ;;
  status) require_foundry; show_status ;;
  stop)
    if [ -f "$PID_FILE" ] && kill -0 "$(cat "$PID_FILE")" 2>/dev/null; then
      kill "$(cat "$PID_FILE")"; rm -f "$PID_FILE"; say "stopped"
    else
      say "no fork started by this script is running"; rm -f "$PID_FILE"
    fi
    ;;
  *) die "usage: $0 [start|status|stop]" ;;
esac
