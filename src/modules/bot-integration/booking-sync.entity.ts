import { Entity, PrimaryColumn, Column, CreateDateColumn, UpdateDateColumn, Index } from 'typeorm';
import { nativeDateTimeColumnType } from '../../common/utils/column-types';

@Entity('booking_sync')
export class BookingSync {
  @PrimaryColumn('text')
  id!: string;

  @Column({ type: 'varchar', length: 255 })
  @Index('IDX_booking_sync_vercelBookingId')
  vercelBookingId!: string;

  @Column({ type: 'varchar', length: 20 })
  @Index('IDX_booking_sync_phoneNumber')
  phoneNumber!: string;

  @Column({ type: 'varchar', length: 255 })
  customerName!: string;

  @Column({ type: 'varchar', length: 100 })
  service!: string;

  @Column({ type: 'date' })
  appointmentDate!: Date;

  @Column({ type: 'time' })
  appointmentTime!: string;

  @Column({ type: 'varchar', length: 50, default: 'pending' })
  status!: string;

  @Column({ type: 'boolean', default: false })
  reminderSent!: boolean;

  @Column({ type: nativeDateTimeColumnType(), nullable: true })
  reminderSentAt!: Date | null;

  @Column({ type: nativeDateTimeColumnType(), nullable: true })
  customerResponseAt!: Date | null;

  @Column({ type: 'varchar', length: 10, nullable: true })
  customerResponse!: string | null; // '1' for confirm, '2' for cancel

  @CreateDateColumn({ type: nativeDateTimeColumnType() })
  createdAt!: Date;

  @UpdateDateColumn({ type: nativeDateTimeColumnType() })
  updatedAt!: Date;
}
