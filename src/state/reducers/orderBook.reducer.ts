import type { Reducer } from 'redux';
import type {
  Price,
  ProductId,
  Size,
  Total,
} from '../../types/orderBook.types';
import { asNumber, assert, asTotal } from '../../types/util.types';
import type {
  DataUpdate,
  OrderBookActions,
  SnapshotReceived,
} from '../actions/orderBook.actions';
import { OrderBookActionTypes } from '../actions/orderBook.actions';

interface RawDetails {
  type: 'RawDetails';
  price: Price;
  size: Size;
}
export interface CalculatedOrderDetails {
  type: 'CalculatedDetails';
  price: Price;
  size: Size;
  total: Total;
}

type OrderDetails = RawDetails | CalculatedOrderDetails;

interface NeverLoaded {
  type: 'NeverLoaded';
}
interface ConnectedWaitingForData {
  type: 'ConnectedWaitingForData';
}

interface Connected {
  type: 'Connected';
  asks: Map<Price, CalculatedOrderDetails>;
  bids: Map<Price, CalculatedOrderDetails>;
  productId: ProductId;
  numLevels: number;
  maxTotal: {
    lastVisibleAsksIndex: number;
    lastVisibleBidsIndex: number;
    totalValue: number;
  };
}

interface Disconnected extends Omit<Connected, 'type'> {
  type: 'Disconnected';
}

export type OrderBookState =
  | NeverLoaded
  | ConnectedWaitingForData
  | Connected
  | Disconnected;

const initialState: OrderBookState = { type: 'NeverLoaded' };

const generateCalculatedOrderDetails = (
  acc: { total: number; map: Map<Price, CalculatedOrderDetails> },
  [price, size]: [Price, Size]
) => {
  if (size === 0) {
    return acc;
  }

  acc.total += asNumber(size);
  acc.map.set(price, {
    type: 'CalculatedDetails',
    price,
    size,
    total: asTotal(acc.total),
  });

  return acc;
};

const generateCalculatedOrderDetailsFromExisting = (
  acc: { total: number; map: Map<Price, CalculatedOrderDetails> },
  [price, value]: [Price, RawDetails | CalculatedOrderDetails]
) => {
  if (value.size === 0) {
    return acc;
  }

  acc.total += asNumber(value.size);
  acc.map.set(price, {
    type: 'CalculatedDetails',
    price,
    size: value.size,
    total: asTotal(acc.total),
  });

  return acc;
};

const handleSnapshotReceived = (
  { payload }: SnapshotReceived,
  prevState: OrderBookState
): OrderBookState => {
  const { total: asksTotal, map: asks } = payload.asks
    .sort(([priceA], [priceB]) => priceA - priceB)
    .reduce<{ total: number; map: Map<Price, CalculatedOrderDetails> }>(
      generateCalculatedOrderDetails,
      { total: 0, map: new Map() }
    );

  const { total: bidsTotal, map: bids } = payload.bids
    .sort(([priceA], [priceB]) => priceB - priceA)
    .reduce<{ total: number; map: Map<Price, CalculatedOrderDetails> }>(
      generateCalculatedOrderDetails,
      { total: 0, map: new Map() }
    );

  return {
    type: 'Connected',
    numLevels: payload.numLevels,
    productId: payload.product_id,
    asks,
    bids,
    maxTotal: {
      ...(prevState.type === 'Connected'
        ? {
            ...prevState.maxTotal,
          }
        : {
            lastVisibleAsksIndex: asks.size - 1,
            lastVisibleBidsIndex: bids.size - 1,
          }),
      totalValue: Math.max(asksTotal, bidsTotal),
    },
  };
};

const handleDataUpdate = (
  { payload }: DataUpdate,
  prevState: OrderBookState
): OrderBookState => {
  assert(prevState.type === 'Connected');

  const asksTmp = new Map<Price, OrderDetails>(prevState.asks);

  payload.asks.forEach(([price, size]) => {
    if (size === 0) {
      asksTmp.delete(price);
      return;
    }

    asksTmp.set(price, { type: 'RawDetails', price, size });
  });

  const { map: asks } = Array.from(asksTmp.entries())
    .sort(([priceA], [priceB]) => priceA - priceB)
    .reduce(generateCalculatedOrderDetailsFromExisting, {
      total: 0,
      map: new Map(),
    });

  const bidsTmp = new Map<Price, OrderDetails>(prevState.bids);

  payload.bids.forEach(([price, size]) => {
    if (size === 0) {
      return;
    }

    bidsTmp.set(price, { type: 'RawDetails', price, size });
  });

  const { map: bids } = Array.from(bidsTmp.entries())
    .sort(([priceA], [priceB]) => priceB - priceA)
    .reduce(generateCalculatedOrderDetailsFromExisting, {
      total: 0,
      map: new Map(),
    });

  return {
    ...prevState,
    asks,
    bids,

    maxTotal: {
      ...prevState.maxTotal,
      totalValue: Math.max(
        Array.from(bids.values())[
          Math.min(prevState.maxTotal.lastVisibleBidsIndex, bids.size - 1)
        ].total,
        Array.from(asks.values())[
          Math.min(prevState.maxTotal.lastVisibleAsksIndex, asks.size - 1)
        ].total
      ),
    },
  };
};

const handleUpdateLastVisibleBidsIndexChange = (
  bidsIndex: number,
  prevState: OrderBookState
) => {
  assert(prevState.type === 'Connected');

  return handleLastVisibleItemIndexChange(
    bidsIndex,
    prevState.maxTotal.lastVisibleAsksIndex,
    prevState
  );
};

const handleUpdateLastVisibleAsksIndexChange = (
  asksIndex: number,
  prevState: OrderBookState
) => {
  assert(prevState.type === 'Connected');

  return handleLastVisibleItemIndexChange(
    prevState.maxTotal.lastVisibleBidsIndex,
    asksIndex,
    prevState
  );
};

const handleLastVisibleItemIndexChange = (
  bidsIndex: number,
  asksIndex: number,
  prevState: Connected
): OrderBookState => ({
  ...prevState,
  maxTotal: {
    lastVisibleBidsIndex: bidsIndex,
    lastVisibleAsksIndex: asksIndex,
    totalValue: Math.max(
      Array.from(prevState.bids.values())[
        Math.min(bidsIndex, prevState.bids.size - 1)
      ].total,
      Array.from(prevState.asks.values())[
        Math.min(asksIndex, prevState.asks.size - 1)
      ].total
    ),
  },
});

const _orderBookReducer = (
  previousState: OrderBookState,
  action: OrderBookActions
): OrderBookState => {
  switch (action.type) {
    case OrderBookActionTypes.OpenStream:
      console.debug('open');
      return previousState;
    case OrderBookActionTypes.CloseStream:
      console.debug('close');
      return previousState;
    case OrderBookActionTypes.SnapshotReceived:
      return handleSnapshotReceived(action, previousState);
    case OrderBookActionTypes.DataUpdate:
      return handleDataUpdate(action, previousState);
    case OrderBookActionTypes.SocketConnected:
    case OrderBookActionTypes.SocketDisconnected:
      console.debug(action.type);
      return previousState;
    case OrderBookActionTypes.UpdateBidsLastVisibleIndex:
      return handleUpdateLastVisibleBidsIndexChange(
        action.index,
        previousState
      );
    case OrderBookActionTypes.UpdateAsksLastVisibleIndex:
      return handleUpdateLastVisibleAsksIndexChange(
        action.index,
        previousState
      );
    case OrderBookActionTypes.UnsupportedBackendResponse:
    case OrderBookActionTypes.InfoReceived:
    case OrderBookActionTypes.SubscribeConfirmationReceived:
      return previousState;
  }
};

export const orderBookReducer: Reducer<OrderBookState, OrderBookActions> = (
  previousState: OrderBookState = initialState,
  action: OrderBookActions
) => _orderBookReducer(previousState, action) ?? initialState;
