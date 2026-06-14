import { Entity, PrimaryColumn, Column, UpdateDateColumn } from 'typeorm';

@Entity({ name: 'system_time' })
export class SystemTimeEntity {
  @PrimaryColumn({ type: 'int', default: 1 })
  id: number = 1;

  @Column({
    name: 'offset_milliseconds',
    type: 'bigint',
    default: 0,
    transformer: {
      to: (value: number) => value.toString(),
      from: (value: string) => parseInt(value, 10) || 0,
    },
  })
  offsetMilliseconds: number = 0;

  @Column({
    name: 'last_server_time',
    type: 'timestamptz',
    default: () => 'NOW()',
  })
  lastServerTime!: Date;

  @UpdateDateColumn({
    name: 'updated_at',
    type: 'timestamptz',
    default: () => 'NOW()',
  })
  updatedAt!: Date;
}
