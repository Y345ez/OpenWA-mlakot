import { Entity, PrimaryColumn, Column, CreateDateColumn, UpdateDateColumn, Index } from 'typeorm';

@Entity('booking_sync')
export class BookingSync {
  @PrimaryColumn('text')
  id!: string;

  @Column({ type: 'varchar', length: 255 })
  @Index()
  vercelBookingId!: string;

  @Column({ type: 'varchar', length: 20 })
  @Index()
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

  @Column({ type: 'datetime', nullable: true })
  reminderSentAt!: Date | null;

  @Column({ type: 'datetime', nullable: true })
  customerResponseAt!: Date | null;

  @Column({ type: 'varchar', length: 10, nullable: true })
  customerResponse!: string | null; // '1' for confirm, '2' for cancel

  @CreateDateColumn({ type: 'datetime' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'datetime' })
  updatedAt!: Date;
}
