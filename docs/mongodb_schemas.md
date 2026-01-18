# MongoDB Schemas

## User
```js
{
  _id: ObjectId,
  email: String,
  role: 'buyer' | 'provider',
  createdAt: Date
}
```

## Provider
```js
{
  _id: ObjectId,
  userId: ObjectId,
  reputation: Number,
  active: Boolean
}
```

## Clan
```js
{
  _id: ObjectId,
  name: String,
  members: [ObjectId],
  revenueSplit: Number
}
```

## Session
```js
{
  _id: ObjectId,
  buyerId: ObjectId,
  proxyId: ObjectId,
  bytesUsed: Number,
  startedAt: Date,
  endedAt: Date
}
```

